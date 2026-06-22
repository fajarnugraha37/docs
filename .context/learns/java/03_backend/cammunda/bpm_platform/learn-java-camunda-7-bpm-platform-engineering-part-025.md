# learn-java-camunda-7-bpm-platform-engineering-part-025.md

# Part 025 — Performance Engineering: Throughput, Latency, Hot Tables, Query Patterns, and Load Testing

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Bagian: `025`  
> Topik: Camunda 7 Performance Engineering  
> Target: Java engineer/tech lead yang perlu mendesain, mengoperasikan, dan mendiagnosis Camunda 7 di lingkungan enterprise/regulatory production.

---

## 0. Posisi Bagian Ini Dalam Seri

Bagian sebelumnya sudah membangun fondasi:

- engine architecture,
- execution tree,
- transaction boundary,
- async continuation,
- job executor,
- database schema,
- optimistic locking,
- variable system,
- external task,
- message correlation,
- timer,
- human task,
- history/audit,
- security,
- Spring Boot/Java EE integration,
- REST governance,
- DMN/CMMN.

Bagian ini menjawab pertanyaan produksi yang biasanya baru muncul ketika workflow sudah besar:

> “Kenapa proses lambat?”  
> “Kenapa job menumpuk?”  
> “Kenapa database tinggi?”  
> “Berapa throughput maksimal?”  
> “Apakah bottleneck ada di engine, DB, worker, model BPMN, variable, history, atau query UI?”  
> “Bagaimana load test Camunda 7 secara benar?”

Performance engineering Camunda 7 bukan sekadar menambah thread pool. Camunda 7 adalah **database-backed durable process engine**. Artinya performance dipengaruhi oleh:

1. jumlah command engine,
2. jumlah transaction,
3. jumlah DB write/read,
4. shape execution tree,
5. volume variable/history,
6. job acquisition/execution,
7. external task worker behavior,
8. task/history query pattern,
9. database index dan maintenance,
10. modelling decision di BPMN/DMN.

---

## 1. Mental Model Utama: Camunda 7 Performance Adalah DB-Coordinated State Machine Performance

Camunda 7 tidak bekerja seperti pure in-memory workflow runner. Ia menyimpan runtime state ke relational database. Ini membuatnya kuat untuk long-running process, crash recovery, audit, dan human workflow. Tetapi konsekuensinya:

- setiap wait state penting berarti DB state,
- setiap async continuation berarti job row,
- setiap user task berarti task row,
- setiap variable durable berarti variable row/byte array row,
- setiap history level tinggi berarti tambahan history write,
- setiap query task/history/process instance bisa menjadi DB query mahal,
- cluster scalability akhirnya dibatasi database.

Mental model paling sederhana:

```text
Throughput Camunda 7
  = kemampuan aplikasi + job executor + worker fleet
    untuk menjalankan command engine
    tanpa membuat database, locks, history, variable serialization,
    atau external side-effect menjadi bottleneck.
```

Camunda 7 bisa sangat cepat untuk workflow yang ramping, tetapi bisa lambat bila:

- model terlalu chatty,
- setiap step menulis variable besar,
- history `FULL` dipakai tanpa retention design,
- tasklist query mencari variable bebas,
- external task worker fetch terlalu agresif,
- job executor thread terlalu banyak dibanding DB pool,
- process model menciptakan optimistic locking storm,
- process instance start/completion rate lebih tinggi dari kapasitas DB write,
- audit/reporting query langsung menghantam operational schema.

---

## 2. Performance Bukan Satu Angka

Saat seseorang bertanya “Camunda kuat berapa TPS?”, pertanyaannya kurang lengkap.

Camunda workload minimal harus dipecah menjadi beberapa metrik:

| Dimensi | Pertanyaan |
|---|---|
| Process start throughput | Berapa process instance baru per detik/menit? |
| Command latency | Berapa lama `startProcessInstance`, `complete task`, `correlate message`, `fetchAndLock`? |
| Job throughput | Berapa async job selesai per detik/menit? |
| External task throughput | Berapa external task completed per detik/menit per topic? |
| Timer latency | Seberapa terlambat timer job dieksekusi dari due date? |
| User task query latency | Seberapa cepat work queue menampilkan task? |
| History query latency | Seberapa cepat audit/report query? |
| Incident rate | Berapa failed job, lock expired, timeout, optimistic locking? |
| DB pressure | CPU, IO, lock wait, buffer cache, slow query, connection usage? |
| Worker pressure | queue depth, active threads, retry, remote dependency latency? |

Satu process model sederhana bisa mencapai throughput tinggi. Process model yang punya:

- banyak parallel multi-instance,
- object variable besar,
- history full,
- banyak listeners,
- banyak synchronous remote call,
- user task search by variables,
- heavy DMN evaluation,
- frequent migration/modification,

akan punya profil performa sangat berbeda.

---

## 3. Latency vs Throughput vs Capacity

Tiga istilah ini tidak boleh dicampur.

### 3.1 Latency

Latency adalah waktu untuk menyelesaikan satu operasi.

Contoh:

```text
POST /case/{id}/submit
  -> validate domain state
  -> start Camunda process
  -> create first user task
  -> commit
  -> return response
```

Latency user-facing dipengaruhi oleh:

- synchronous path sebelum wait state,
- DB transaction time,
- delegate/listener execution,
- variable serialization,
- history writes,
- downstream synchronous call,
- lock wait.

### 3.2 Throughput

Throughput adalah jumlah operasi per satuan waktu.

Contoh:

```text
- 100 process instance started/minute
- 5,000 async jobs completed/minute
- 20,000 external task completions/hour
```

Throughput dipengaruhi oleh:

- jumlah app nodes,
- job executor acquisition rate,
- thread pool,
- DB connection pool,
- worker fleet,
- DB CPU/IO,
- schema/index,
- history level,
- remote dependency capacity.

### 3.3 Capacity

Capacity adalah batas aman workload sebelum sistem tidak stabil.

Contoh indikator capacity limit:

- DB CPU sustained > 80%,
- connection pool exhausted,
- job queue growing continuously,
- timer delay terus membesar,
- external task lock expired meningkat,
- incident count naik,
- UI task query > SLA,
- optimistic locking storm,
- GC pause meningkat,
- history cleanup tidak pernah mengejar pertumbuhan.

Top 1% engineer tidak hanya bertanya “cepat atau lambat”, tetapi:

> “Apa bottleneck dominan, bagaimana dibuktikan, dan apa trade-off perbaikan?”

---

## 4. Camunda 7 Hot Path

Camunda 7 workload biasanya berada pada beberapa hot path berikut.

### 4.1 Start Process Instance

Typical flow:

```text
HTTP/API command
  -> RuntimeService.startProcessInstanceByKey(...)
  -> command context opened
  -> process definition loaded
  -> execution tree created
  -> variables inserted
  -> synchronous path executed until wait state/async boundary/end
  -> runtime/history rows flushed
  -> DB commit
```

Performance risk:

- start event langsung mengeksekusi banyak service task synchronous,
- terlalu banyak start variables,
- large object variable,
- business key tidak digunakan dengan baik,
- history level tinggi,
- process definition cache miss,
- DB insert pressure.

Design improvement:

```text
Start process -> asyncBefore first heavy service task -> return fast
```

Tetapi ini mengubah semantics: caller hanya tahu process dimulai, bukan semua work selesai.

### 4.2 Complete User Task

Typical flow:

```text
TaskService.complete(taskId, variables)
  -> validate task exists/authorization
  -> delete/update task runtime row
  -> write task history
  -> set variables
  -> continue execution synchronously
  -> possibly create next task/job/end process
  -> commit
```

Performance risk:

- after task completion langsung call remote API,
- listener berat pada complete event,
- banyak gateway/DMN/synchronous delegate,
- variable besar ditulis saat complete,
- optimistic locking karena double complete atau parallel state.

Safer pattern:

```text
User completes task
  -> commit human decision and create async job
  -> job executor handles expensive downstream processing
```

### 4.3 Async Job Execution

Typical flow:

```text
Job acquisition thread
  -> select acquirable jobs
  -> lock jobs
  -> execution thread executes job
  -> command context
  -> continue BPMN
  -> commit or fail/retry/incident
```

Performance risk:

- acquisition too aggressive,
- job executor threads > DB capacity,
- lock duration mismatch,
- retry storm,
- exclusive job serialization,
- job priority starvation,
- due date ordering missing index,
- slow delegate blocks executor thread.

### 4.4 External Task Worker

Typical flow:

```text
Worker fetchAndLock(topic, maxTasks)
  -> engine selects unlocked external tasks
  -> worker performs work outside engine
  -> worker complete/failure/bpmnError
  -> engine transaction updates process state
```

Performance risk:

- too many workers fetch too often,
- maxTasks too high,
- lock duration too short,
- remote dependency slower than lock duration,
- completion bursts overload DB,
- variable payload too large,
- no backpressure,
- failed tasks retried aggressively.

### 4.5 Tasklist / Work Queue Query

Typical flow:

```text
User opens inbox
  -> query active tasks by assignee/candidate group/tenant/process/variable/sort
  -> count query maybe executed
  -> display page
```

Performance risk:

- candidate group membership huge,
- query by variable without proper design,
- sorting by unindexed fields,
- unrestricted cross-tenant queries,
- count query on huge table,
- UI polling too often,
- history join mixed with runtime query.

### 4.6 History/Audit Query

Typical flow:

```text
Case audit screen
  -> query historic process/task/activity/variable/detail
  -> reconstruct timeline
```

Performance risk:

- `FULL` history generates huge detail table,
- variable updates too frequent,
- querying CLOB/byte array,
- reporting on operational database,
- no retention/removal time,
- no archive/projection.

---

## 5. Performance Cost Model

A useful approximation:

```text
Cost(command)
  = DB reads/writes
  + variable serialization/deserialization
  + history writes
  + execution tree mutation
  + delegate/listener/DMN time
  + transaction/lock wait
  + remote side effects if synchronous
  + authorization/tenant check overhead
  + query complexity
```

### 5.1 DB Writes

Common write-heavy operations:

- start process,
- create user task,
- complete user task,
- create async job,
- execute async job,
- timer fire,
- external task complete,
- variable update,
- history write,
- incident create/update,
- migration/modification.

### 5.2 DB Reads

Common read-heavy operations:

- task query,
- process instance query,
- job acquisition query,
- external task fetch query,
- history query,
- process definition lookup,
- authorization check,
- variable query.

### 5.3 Serialization

Variable serialization cost can dominate if:

- object variables are large,
- Java serialization is used,
- JSON is repeatedly parsed/written,
- external task fetches many variables,
- REST API deserializes object values,
- history stores variable detail repeatedly.

### 5.4 History Cost

History is not free. It adds writes and storage.

Example:

```text
A process with 20 activities, 10 variable updates, 5 user tasks
under high history level
can produce many more rows than one might expect.
```

History level must be chosen as a product/security/compliance decision, not default convenience.

---

## 6. Throughput Bottleneck Taxonomy

When performance degrades, classify bottleneck first.

### 6.1 Engine CPU Bottleneck

Symptoms:

- app node CPU high,
- DB not high,
- thread pool saturated,
- JFR shows Java code/delegate/serialization hot,
- GC pressure high,
- long delegate/listener execution.

Likely causes:

- heavy JavaDelegate,
- large object serialization,
- DMN evaluation in loop,
- synchronous HTTP client waiting,
- inefficient custom listener/plugin,
- too many variables copied.

Fix direction:

- async boundary,
- external task,
- reduce variable payload,
- cache static data carefully,
- optimize delegate code,
- move heavy computation out of engine transaction,
- profile with JFR.

### 6.2 Database Bottleneck

Symptoms:

- DB CPU/IO high,
- slow query log shows ACT tables,
- connection pool wait,
- job acquisition slow,
- lock waits,
- history cleanup lag,
- high write IOPS.

Likely causes:

- too many history writes,
- task/history queries expensive,
- job executor over-tuned,
- variable search abuse,
- lack of appropriate DB maintenance,
- table/index bloat,
- reporting queries on operational DB,
- many cluster nodes competing for jobs.

Fix direction:

- reduce history level or variable detail,
- add read model/projection,
- tune job executor concurrency,
- inspect query plans,
- ensure correct indexes,
- archive/cleanup history,
- separate reporting from operational DB,
- DB capacity scaling.

### 6.3 Remote Dependency Bottleneck

Symptoms:

- app threads waiting on HTTP/SOAP/DB/SFTP/Kafka,
- job executor active threads maxed,
- external task lock expired,
- retries due to timeout,
- downstream service latency high.

Likely causes:

- synchronous remote call inside JavaDelegate,
- no timeout/circuit breaker,
- worker concurrency too high,
- remote service capacity lower than worker demand,
- retry storm.

Fix direction:

- external task or message wait state,
- bounded concurrency,
- backpressure,
- idempotency,
- circuit breaker,
- retry policy with jitter/backoff,
- separate remote service SLA from engine SLA.

### 6.4 Model Bottleneck

Symptoms:

- many jobs for one business case,
- optimistic locking on joins,
- process instance has huge execution tree,
- many variable writes per path,
- complex gateway/DMN combinations,
- high token fan-out.

Likely causes:

- parallel multi-instance too large,
- every micro-step modelled as BPMN activity,
- loops with durable variable updates,
- excessive async boundaries,
- god process.

Fix direction:

- collapse technical steps,
- move algorithmic loops into application service,
- aggregate before join,
- partition workload,
- use batch processing outside process instance,
- redesign model around stable business states.

---

## 7. Job Executor Performance Engineering

Job Executor is one of the biggest levers and one of the easiest things to misconfigure.

### 7.1 Job Executor Is Not Unlimited Parallelism

Increasing job executor threads increases pressure on:

- DB connection pool,
- DB CPU/IO,
- remote systems called by delegates,
- optimistic locking probability,
- incident/retry volume,
- JVM CPU/GC.

Naive tuning:

```text
Job slow -> increase threads from 10 to 100
```

Better tuning:

```text
Job slow -> measure:
  - acquisition delay
  - active executor threads
  - DB wait
  - delegate latency
  - retry/incident rate
  - queue growth
then increase only the constrained part.
```

### 7.2 Core Metrics for Jobs

Track at least:

```text
- number of executable jobs
- number of locked jobs
- number of failed jobs
- retries distribution
- oldest due job age
- job execution duration p50/p95/p99
- acquisition duration
- acquisition batch size
- job executor active threads
- DB connection wait
- incident creation rate
```

Useful diagnostic SQL pattern:

```sql
select
  HANDLER_TYPE_,
  count(*) as cnt,
  min(DUEDATE_) as oldest_due,
  sum(case when LOCK_OWNER_ is not null then 1 else 0 end) as locked_cnt,
  sum(case when RETRIES_ = 0 then 1 else 0 end) as no_retry_cnt
from ACT_RU_JOB
group by HANDLER_TYPE_
order by cnt desc;
```

```sql
select
  PROCESS_DEF_ID_,
  count(*) as cnt,
  min(DUEDATE_) as oldest_due
from ACT_RU_JOB
where RETRIES_ > 0
  and (DUEDATE_ is null or DUEDATE_ <= current_timestamp)
  and (LOCK_EXP_TIME_ is null or LOCK_EXP_TIME_ < current_timestamp)
group by PROCESS_DEF_ID_
order by cnt desc;
```

### 7.3 Acquisition Batch Size

Large acquisition batch:

- fewer acquisition cycles,
- more work per DB round-trip,
- but bigger bursts,
- higher contention,
- potentially unfair distribution.

Small acquisition batch:

- smoother acquisition,
- less burst pressure,
- but more acquisition overhead,
- lower max throughput.

Tune based on:

- job duration,
- DB latency,
- number of nodes,
- desired fairness,
- job priority strategy.

### 7.4 Thread Pool and DB Pool Must Be Coherent

Anti-pattern:

```text
jobExecutor maxPoolSize = 50
DB pool max size = 20
HTTP request threads = 200
external task completion traffic = high
```

Result:

- job executor waits on DB connections,
- request traffic waits too,
- timeouts create retries,
- retries create more jobs,
- system collapses.

Principle:

```text
Total concurrent engine commands
  <= DB pool capacity
  <= DB capacity for transactional workload
```

Not every thread needs a DB connection at every millisecond, but under high load this approximation prevents dangerous overcommit.

### 7.5 Exclusive Jobs

Exclusive jobs can reduce optimistic locking by serializing jobs related to the same process instance.

But exclusive job is not a magic global lock:

- it helps with jobs in same process instance,
- it can reduce throughput for one hot instance,
- it does not solve duplicate external events,
- it does not solve remote side-effect idempotency,
- it may create apparent serialization where parallelism was expected.

Use it as a conflict-reduction mechanism, not as business concurrency control.

### 7.6 Job Priority

Job priority helps when not all work is equal.

Example:

```text
- customer-facing SLA escalation job: high priority
- nightly housekeeping process: low priority
- bulk migration job: very low priority
```

But priority creates risks:

- low priority starvation,
- operational invisibility,
- priority inflation where every team wants high priority,
- index/query plan changes.

Govern priority centrally.

### 7.7 Retry Storm

Retry storm happens when many jobs fail for the same systemic reason and retry quickly.

Example:

```text
External API down
  -> 10,000 async jobs fail
  -> retries happen after short interval
  -> API still down
  -> DB/job executor flooded
  -> incident volume explodes
```

Mitigation:

- retry time cycle with increasing delay,
- circuit breaker in delegate/worker,
- incident suppression/aggregation,
- bulk suspend process/job where appropriate,
- operations playbook.

---

## 8. External Task Performance Engineering

External task performance is controlled by both engine and worker fleet.

### 8.1 External Task Throughput Formula

Approximate:

```text
throughput = active_workers * concurrency_per_worker / avg_task_duration
```

But actual throughput is capped by:

- engine fetch/lock capacity,
- engine completion capacity,
- DB write capacity,
- remote dependency capacity,
- lock duration,
- retry/failure rate,
- variable payload size.

### 8.2 Fetch Size

`maxTasks` should not be blindly high.

High `maxTasks`:

- fewer fetch calls,
- better batching,
- but can lock too many tasks on one worker,
- can create uneven distribution,
- can increase lock expiry risk.

Low `maxTasks`:

- fairer distribution,
- lower lock hoarding,
- but more REST calls,
- lower throughput ceiling.

Rule of thumb:

```text
maxTasks should reflect worker actual near-term processing capacity,
not the total backlog size.
```

### 8.3 Lock Duration

Lock duration must be greater than expected processing time plus network jitter.

Too short:

- task lock expires while worker still processing,
- another worker fetches same task,
- duplicate side effect.

Too long:

- failed worker delays recovery,
- task appears stuck longer,
- manual recovery slower.

For variable-duration work:

- choose moderate lock duration,
- extend lock periodically,
- ensure extension stops on shutdown,
- maintain idempotency anyway.

### 8.4 Completion Burst

A large worker fleet can produce completion bursts:

```text
1,000 workers finish at same time
  -> 1,000 REST complete calls
  -> 1,000 engine commands
  -> DB write spike
```

Mitigation:

- bounded concurrency,
- jitter,
- rate limit per topic,
- worker-side queue,
- scale by downstream capacity, not just backlog.

### 8.5 Variable Fetch Allowlist

Bad:

```text
fetchAndLock topic = risk-check
fetch all variables
```

Better:

```text
fetchAndLock topic = risk-check
variables = [caseId, riskPayloadRef, applicantType, jurisdiction]
```

Large variables kill external task throughput because they travel over REST and may trigger serialization/deserialization.

---

## 9. Runtime Table Hotspots

### 9.1 `ACT_RU_JOB`

Hot when:

- many async continuations,
- timers,
- failed jobs,
- retries,
- job executor cluster,
- priority/due date sorting.

Watch:

```sql
select count(*) from ACT_RU_JOB;
```

```sql
select RETRIES_, count(*)
from ACT_RU_JOB
group by RETRIES_
order by RETRIES_;
```

```sql
select LOCK_OWNER_, count(*)
from ACT_RU_JOB
where LOCK_OWNER_ is not null
group by LOCK_OWNER_;
```

### 9.2 `ACT_RU_EXECUTION`

Hot when:

- many active process instances,
- parallel/multi-instance execution,
- message subscription,
- process instance modification,
- joins causing optimistic locking.

Watch execution shape:

```sql
select PROCESS_DEF_ID_, count(*)
from ACT_RU_EXECUTION
group by PROCESS_DEF_ID_
order by count(*) desc;
```

```sql
select PROC_INST_ID_, count(*) as executions
from ACT_RU_EXECUTION
group by PROC_INST_ID_
having count(*) > 50
order by executions desc;
```

Large execution count per instance may be legitimate for parallel/multi-instance workflows, but it must be understood.

### 9.3 `ACT_RU_TASK`

Hot when:

- many user tasks,
- tasklist/inbox queries,
- candidate group search,
- tenant filtering,
- due date sorting,
- variable filters.

Watch:

```sql
select TASK_DEF_KEY_, count(*)
from ACT_RU_TASK
group by TASK_DEF_KEY_
order by count(*) desc;
```

```sql
select ASSIGNEE_, count(*)
from ACT_RU_TASK
group by ASSIGNEE_
order by count(*) desc;
```

### 9.4 `ACT_RU_VARIABLE`

Hot when:

- variables updated frequently,
- variable query/filter used,
- many local variables in multi-instance,
- large serialized values referenced.

Watch:

```sql
select TYPE_, count(*)
from ACT_RU_VARIABLE
group by TYPE_
order by count(*) desc;
```

```sql
select NAME_, count(*)
from ACT_RU_VARIABLE
group by NAME_
order by count(*) desc;
```

### 9.5 `ACT_GE_BYTEARRAY`

Hot/storage-heavy when:

- serialized object variables,
- file variables,
- large JSON/XML,
- exception stack traces,
- deployment resources,
- history details.

Watch size by table/storage tooling, not just row count.

### 9.6 History Tables

Common growth tables:

- `ACT_HI_PROCINST`,
- `ACT_HI_ACTINST`,
- `ACT_HI_TASKINST`,
- `ACT_HI_VARINST`,
- `ACT_HI_DETAIL`,
- `ACT_HI_JOB_LOG`,
- `ACT_HI_INCIDENT`,
- `ACT_HI_OP_LOG`.

`ACT_HI_DETAIL` can explode when variable updates are frequent under high history detail level.

---

## 10. Query Pattern Engineering

### 10.1 Avoid Variable Query Abuse

Variable filtering is convenient but often expensive.

Bad tasklist query idea:

```text
Find all active tasks where:
  variable applicantName contains 'john'
  variable postalCode starts with '12'
  variable riskScore > 70
  variable agency = 'CEA'
  variable status = 'PENDING_REVIEW'
order by lastUpdated desc
```

This is not a good job for Camunda runtime schema.

Better:

```text
Camunda owns workflow state.
Domain/search projection owns work queue/search.
```

Projection table example:

```sql
case_work_item(
  case_id,
  process_instance_id,
  task_id,
  task_definition_key,
  agency,
  jurisdiction,
  applicant_name_normalized,
  risk_score,
  status,
  assignee,
  candidate_group,
  due_at,
  priority,
  updated_at
)
```

Camunda task query becomes internal lookup. User search uses domain projection.

### 10.2 Count Query Cost

Many UI pages execute:

```text
select page
select count
```

On large filtered task/history data, count can be as expensive as data query.

Mitigation:

- avoid exact count for large lists,
- use “has next page” pagination,
- cache approximate counts,
- precompute work queue counts,
- restrict query filters.

### 10.3 Pagination

Avoid offset pagination deep into large result sets.

Bad:

```text
page=5000&pageSize=20
```

Better:

```text
keyset pagination over projection table
where updated_at < :cursorUpdatedAt
order by updated_at desc, id desc
limit 20
```

Camunda APIs may expose pagination, but enterprise search UI should not depend on deep offset scans over engine tables.

### 10.4 Sorting

Sorting by unindexed fields on large runtime/history tables is expensive.

Common sort fields:

- created time,
- due date,
- priority,
- assignee,
- process definition,
- tenant,
- business key.

If these are critical UI dimensions, consider projection/indexing outside engine schema.

---

## 11. History Level and Audit Performance

History level has direct performance impact.

### 11.1 Low History

Pros:

- fewer writes,
- less storage,
- faster process execution.

Cons:

- weak audit,
- weak troubleshooting,
- less forensic information.

### 11.2 High/Full History

Pros:

- rich audit,
- better incident forensics,
- variable detail trace,
- user operation log.

Cons:

- high write amplification,
- larger tables/indexes,
- cleanup burden,
- possible PII exposure,
- slower reporting if not archived/projected.

### 11.3 Regulatory Design

For regulatory systems, do not simply set `FULL` and assume done.

Better pattern:

```text
Camunda history:
  technical/process execution audit

Domain audit:
  legal/business decision audit

Document/evidence store:
  immutable evidence artifact

Reporting/archive store:
  long-term analytical access
```

This gives better performance and stronger audit semantics.

---

## 12. Variable Performance Engineering

### 12.1 Small Variables Are State Facts

Good process variables:

```text
caseId
businessKey
tenantId
currentRiskBand
decisionCode
reviewLevel
slaDeadline
```

Bad process variables:

```text
entire customer profile object
entire application form as Java object
large PDF bytes
massive API response
full audit trail JSON
large list of child records
```

### 12.2 Store References, Not Payloads

Preferred:

```text
process variable: evidenceDocumentId = DOC-123
external storage: actual document
```

Instead of:

```text
process variable: evidenceDocumentBytes = 20 MB PDF
```

### 12.3 JSON Snapshot With Version

If snapshot is needed:

```json
{
  "schemaVersion": 3,
  "caseId": "CASE-123",
  "riskBand": "HIGH",
  "facts": {
    "licenseType": "EA",
    "previousWarnings": 2
  }
}
```

But still keep it bounded and avoid frequent mutation.

### 12.4 Avoid Repeated Large Updates

Bad:

```text
Loop over 500 items
  -> update process variable bigJson each iteration
```

Better:

```text
Process variable: batchId
Batch processing table: item-level state
Camunda process: wait for aggregate completion event
```

---

## 13. BPMN Model Performance Smells

### 13.1 Too Many Micro Activities

Bad:

```text
Validate name -> Validate address -> Validate phone -> Validate email -> Validate license -> ...
```

If these are not independent business states, put them in application service and expose one BPMN activity:

```text
Validate Application
```

BPMN should model meaningful business state, not every line of code.

### 13.2 Parallel Multi-Instance Explosion

Parallel multi-instance over thousands of items can create huge execution/job pressure.

Bad:

```text
For each of 10,000 records -> BPMN parallel multi-instance service task
```

Better:

```text
BPMN starts batch
Batch worker processes items outside execution tree
BPMN waits for completion message
```

### 13.3 Excessive Async Boundaries

Async boundary is powerful, but too many boundaries create many jobs and DB transactions.

Bad:

```text
every service task has asyncBefore and asyncAfter by default
```

Better:

```text
async boundary only at:
  - remote side-effect boundary
  - retry/recovery boundary
  - transaction size boundary
  - user-facing latency boundary
  - known conflict reduction point
```

### 13.4 Synchronous Remote Chain

Bad:

```text
Task complete
  -> call Service A
  -> call Service B
  -> call Service C
  -> call Service D
  -> commit
```

One remote timeout rolls back the whole command and may repeat side effects.

Better:

```text
Task complete -> async job
Async job/outbox/external task/message pattern handles remote dependencies
```

### 13.5 Gateway Spaghetti

Complex gateways increase cognitive and runtime complexity.

If gateway conditions are business rules, consider DMN.

If gateway conditions are technical flags, consider refactoring application service.

---

## 14. Database Indexing and Query Plan Discipline

Camunda ships database schema/indexes. Do not casually mutate schema. But production systems sometimes need careful review of query plans, especially for custom/reporting queries or large task/history queries.

Principles:

1. Prefer engine APIs and domain projections.
2. Do not manually update Camunda tables.
3. For read-only diagnostics/reporting, understand schema is not public API.
4. Validate query plans per DB vendor.
5. Do not add indexes blindly; indexes speed reads but slow writes and increase storage.
6. Coordinate with DBA and test under realistic write load.

### 14.1 When Additional Index May Be Justified

Potentially justified when:

- a critical query is stable and frequent,
- query plan shows table scan on huge table,
- index does not duplicate existing index,
- write overhead is acceptable,
- upgrade impact is documented,
- it is tested with representative data.

### 14.2 When Additional Index Is a Smell

Smell when:

- UI uses arbitrary search over process variables,
- reporting directly queries history tables heavily,
- process variables are used as search engine,
- every new feature asks for another ACT table index,
- no retention/cleanup exists.

In that case, build a projection/read model.

---

## 15. Load Testing Camunda 7 Correctly

### 15.1 Load Test The Workflow, Not Just Endpoint

Bad load test:

```text
Only start 1,000 process instances/minute
```

Better load test:

```text
Start process
Complete first user task
Run async jobs
Fetch/complete external tasks
Correlate external messages
Trigger timers if relevant
Query user inbox
Query audit screen
Simulate failure/retry
Run history cleanup/reporting load
```

### 15.2 Use Representative BPMN Model

A realistic model includes:

- same variables,
- same history level,
- same async boundaries,
- same delegates/listeners,
- same DMN,
- same external task topics,
- same remote dependencies or realistic stubs,
- same DB vendor/version,
- same connection pool,
- same indexes,
- same security/tenant settings.

### 15.3 Separate Load Profiles

Use multiple profiles:

#### Profile A — Start Burst

```text
simulate morning intake/import burst
```

Measure:

- start latency,
- DB inserts,
- first task/job creation,
- queue growth.

#### Profile B — Human Task Completion Burst

```text
simulate many users completing review tasks around same time
```

Measure:

- complete latency,
- downstream job creation,
- optimistic locking,
- task query freshness.

#### Profile C — Job Backlog Drain

```text
create large async job backlog, then observe drain rate
```

Measure:

- jobs/minute,
- oldest due age,
- DB CPU,
- job executor active threads,
- failed jobs.

#### Profile D — External Worker Saturation

```text
increase worker count until bottleneck appears
```

Measure:

- fetch latency,
- complete latency,
- lock expiration,
- remote service saturation,
- DB writes.

#### Profile E — Query/Tasklist Load

```text
simulate users opening inbox and searching tasks
```

Measure:

- p95 query latency,
- slow query plans,
- DB CPU,
- count query cost.

#### Profile F — History/Audit Load

```text
simulate audit screen/report access
```

Measure:

- history query latency,
- table/index scans,
- effect on operational job processing.

### 15.4 Failure Load Test

Performance under success is insufficient.

Test:

- downstream API outage,
- DB slow query,
- worker crash after side effect before complete,
- job executor node restart,
- duplicate message delivery,
- timer backlog,
- history cleanup running during business load,
- migration batch during load.

### 15.5 Load Test Metrics

Capture:

```text
Application:
  - request latency p50/p95/p99
  - error rate
  - thread pool usage
  - connection pool usage
  - GC pause
  - CPU/memory

Camunda:
  - job count by type
  - failed jobs
  - incidents
  - external task backlog by topic
  - task count by definition/group
  - process start/completion rate
  - history growth rate

Database:
  - CPU
  - IO
  - buffer/cache hit
  - slow queries
  - lock waits/deadlocks
  - active sessions
  - connection count
  - table/index growth

Workers:
  - active tasks
  - fetch rate
  - completion rate
  - failure rate
  - lock extension count
  - lock expiration
  - downstream latency
```

---

## 16. Benchmarking Methodology

### 16.1 Do Not Benchmark With H2 and Assume Production

H2/local in-memory tests are useful for logic, not production performance.

Production-like benchmark must use:

- real DB vendor,
- similar DB size,
- similar indexes,
- similar history level,
- similar network latency,
- similar JVM/container limits,
- realistic process models,
- realistic variable payload.

### 16.2 Warm-Up Matters

Warm-up includes:

- JVM JIT,
- process definition deployment cache,
- DB cache,
- connection pool warm-up,
- worker warm-up,
- remote dependency warm-up.

Measure steady state and cold start separately.

### 16.3 Test Duration Matters

A 5-minute test may miss:

- table/index growth,
- history cleanup lag,
- memory leak,
- retry storm,
- lock contention after backlog grows,
- DB cache eviction.

Use:

```text
- short spike test
- 1-hour sustained test
- 4–8 hour soak test
- failure/recovery test
```

### 16.4 Think In Capacity Envelope

Produce a capacity envelope:

```text
At workload W:
  - process start: 100/min
  - task completion: 500/min
  - async jobs: 2,000/min
  - external task: 5,000/min
  - task query: 100 concurrent users
  - history query: 20 concurrent users
system remains stable with:
  - DB CPU < 65%
  - p95 API latency < 500 ms
  - timer lag < 30 sec
  - no continuous job backlog growth
```

This is more useful than one TPS number.

---

## 17. Java Runtime Considerations: Java 8 to 25

Camunda 7 compatibility depends on Camunda minor version and distribution. Do not assume every Camunda 7 version supports every Java version.

Performance-wise:

### Java 8

- common in legacy Camunda 7 estates,
- older GC defaults,
- weaker container awareness compared to newer Java,
- compatibility with older Spring/Java EE stacks.

### Java 11

- common migration target,
- better container behavior than Java 8,
- stable LTS baseline.

### Java 17

- strong LTS target for modern workloads,
- better JVM performance/GC options,
- common with Spring Boot 3 ecosystem, but Camunda 7/Spring Boot starter compatibility must be verified.

### Java 21

- modern LTS,
- improved runtime performance,
- virtual threads exist but do not magically improve DB-bound Camunda engine throughput,
- compatibility must follow Camunda support matrix.

### Java 25

- future/modern Java target,
- treat as platform verification project,
- test bytecode compatibility, libraries, containers, Spring version, Camunda version, JDBC driver, app server, plugins.

Important mental model:

```text
Newer Java can improve JVM behavior,
but Camunda 7 throughput is often limited by database and model design.
```

Virtual threads can help blocking app-layer code, but if all paths block on the same DB or same remote dependency, they may increase pressure rather than solve bottleneck.

---

## 18. Tuning Strategy By Symptom

### 18.1 Jobs Are Backlogged

Check:

```sql
select count(*) from ACT_RU_JOB;
```

Then segment:

```sql
select HANDLER_TYPE_, RETRIES_, count(*)
from ACT_RU_JOB
group by HANDLER_TYPE_, RETRIES_
order by count(*) desc;
```

Questions:

- Are jobs due?
- Are jobs locked?
- Are retries 0?
- Are jobs failing repeatedly?
- Is job executor enabled on nodes?
- Is acquisition restricted by deployment-aware config?
- Are threads saturated?
- Is DB pool saturated?
- Is delegate slow?

Fix depends on dominant cause.

### 18.2 Timer Fires Late

Check:

```sql
select min(DUEDATE_) as oldest_due, count(*)
from ACT_RU_JOB
where HANDLER_TYPE_ like '%timer%'
  and RETRIES_ > 0;
```

Possible causes:

- job executor not enabled,
- executor overloaded,
- acquisition prioritizes other jobs,
- DB slow,
- lock contention,
- timer backlog,
- node timezone/config issue.

Fix:

- inspect executor metrics,
- separate workload or priority,
- reduce heavy jobs,
- tune acquisition,
- add capacity only after DB check.

### 18.3 Tasklist Slow

Check:

- query filters,
- count query,
- candidate group size,
- variable filters,
- tenant filters,
- sort fields,
- DB plan,
- data volume.

Fix:

- projection/read model,
- restrict filters,
- keyset pagination,
- precomputed counts,
- avoid variable search,
- separate audit/report DB.

### 18.4 High Optimistic Locking

Check:

- process model join points,
- parallel multi-instance,
- duplicate commands,
- concurrent message correlation,
- job executor nodes,
- exclusive job setting,
- same process instance hot spot.

Fix:

- idempotent client commands,
- async boundaries,
- exclusive jobs,
- aggregate state outside process instance,
- reduce shared variable writes,
- redesign concurrency point.

### 18.5 DB Storage Grows Fast

Check:

- history level,
- `ACT_HI_DETAIL`,
- `ACT_GE_BYTEARRAY`,
- serialized variables,
- file variables,
- exception stack traces,
- cleanup TTL/removal time,
- cleanup job success.

Fix:

- history cleanup,
- variable policy,
- externalize payloads,
- archive/projection,
- retention policy,
- DB maintenance.

---

## 19. Production Performance Checklist

### 19.1 Model Checklist

- [ ] BPMN activities represent meaningful business states.
- [ ] Technical micro-steps are not over-modelled.
- [ ] Async boundaries are intentional.
- [ ] Remote side effects are idempotent.
- [ ] Parallelism is bounded.
- [ ] Multi-instance cardinality has maximum control.
- [ ] Joins are designed to avoid excessive optimistic locking.
- [ ] Timers represent real SLA semantics.
- [ ] User task completion does not synchronously trigger heavy chains.

### 19.2 Variable Checklist

- [ ] Variables are small and typed.
- [ ] Large payloads stored externally.
- [ ] Java serialization avoided.
- [ ] JSON snapshots versioned.
- [ ] External task fetch uses variable allowlist.
- [ ] Variable update frequency controlled.
- [ ] Search fields projected outside Camunda if needed.

### 19.3 Job Executor Checklist

- [ ] Job executor enabled only where intended.
- [ ] Thread pool aligned with DB capacity.
- [ ] Acquisition batch size measured.
- [ ] Retry cycles include backoff.
- [ ] Exclusive jobs configured consciously.
- [ ] Job priority governance exists.
- [ ] Deployment-aware setting understood.
- [ ] Failed job/incident monitoring exists.

### 19.4 External Task Checklist

- [ ] Worker concurrency bounded.
- [ ] Lock duration sized realistically.
- [ ] Lock extension used for long work.
- [ ] Worker has graceful shutdown.
- [ ] Idempotency store exists for side effects.
- [ ] Topic contract versioned.
- [ ] Backpressure exists.
- [ ] Metrics per topic exist.

### 19.5 DB Checklist

- [ ] DB vendor/version supported.
- [ ] Connection pool sized against actual capacity.
- [ ] Slow query monitoring enabled.
- [ ] History cleanup configured and observed.
- [ ] Operational/reporting workload separated if needed.
- [ ] Table/index growth tracked.
- [ ] Backup/restore tested.
- [ ] DBA understands Camunda tables are engine-owned.

### 19.6 Observability Checklist

- [ ] Correlation id propagated.
- [ ] Process instance id/business key logged.
- [ ] Job execution metrics captured.
- [ ] External task metrics captured.
- [ ] DB metrics captured.
- [ ] Incident metrics captured.
- [ ] Timer lag measured.
- [ ] Work queue latency measured.

---

## 20. Case Study: Regulatory Case Management Performance Design

Imagine workflow:

```text
Application submitted
  -> Screening
  -> Officer review
  -> Supervisor approval
  -> Enforcement check
  -> Applicant notification
  -> Appeal window
  -> Closure
```

Naive design:

- store full application JSON as process variable,
- call screening API synchronously during submission,
- use Camunda task query with variable filters for inbox,
- history `FULL` with no cleanup,
- email sent inside JavaDelegate before wait state,
- every validation step as service task,
- nightly report reads `ACT_HI_*` directly.

Likely issues:

- slow submit,
- duplicate email on retry,
- storage growth,
- tasklist slow,
- history query affects runtime,
- retry storm when screening API down.

Better design:

```text
Submission API
  -> domain DB stores application
  -> process starts with caseId/businessKey/tenantId only
  -> asyncBefore screening

Screening
  -> external task worker or outbox command
  -> idempotency by caseId + screeningVersion
  -> result stored in domain DB
  -> process variable stores riskBand/resultId only

Officer Work Queue
  -> projection table maintained from task events/domain state
  -> user search uses projection
  -> task completion API validates business auth
  -> Camunda complete only after domain audit write

Notification
  -> outbox email command
  -> process waits or continues based on policy

Audit
  -> Camunda history for process trace
  -> domain audit for legal decision trace
  -> archive/report model for analytics
```

Performance result:

- fast user-facing submit,
- controlled async workload,
- bounded variables,
- searchable inbox,
- reliable side effects,
- independent reporting,
- explainable audit.

---

## 21. Anti-Patterns Summary

### Anti-Pattern 1 — “Just Add More Job Executor Threads”

Problem:

- increases DB pressure and retry storm risk.

Better:

- identify bottleneck first.

### Anti-Pattern 2 — “Use Process Variables As Search Database”

Problem:

- poor query performance and schema abuse.

Better:

- projection/read model.

### Anti-Pattern 3 — “Full Object Variables Everywhere”

Problem:

- serialization, classpath coupling, storage growth.

Better:

- reference ids + small facts + versioned snapshots.

### Anti-Pattern 4 — “Every Code Step Is BPMN Step”

Problem:

- execution tree/job/history explosion.

Better:

- model business state, not implementation micro-steps.

### Anti-Pattern 5 — “History FULL Solves Audit”

Problem:

- huge storage and still incomplete legal audit.

Better:

- Camunda history + domain audit + archive strategy.

### Anti-Pattern 6 — “Expose Engine REST API To UI”

Problem:

- expensive/uncontrolled queries and weak business authorization.

Better:

- domain API and projection.

### Anti-Pattern 7 — “External Worker Scale Equals Performance”

Problem:

- completion bursts, DB overload, downstream overload.

Better:

- backpressure, rate limit, bounded concurrency.

---

## 22. Practical Performance Investigation Flow

When production is slow:

```text
1. Define symptom precisely
   - API slow?
   - jobs stuck?
   - timers late?
   - tasklist slow?
   - DB high?

2. Measure current state
   - app metrics
   - Camunda runtime tables
   - job/external task backlog
   - DB metrics
   - worker metrics

3. Segment by process/topic/task/job type
   - find dominant workload

4. Identify bottleneck class
   - engine CPU
   - DB
   - remote dependency
   - model design
   - query pattern

5. Apply smallest safe change
   - tune executor
   - reduce query
   - add projection
   - adjust retry
   - add async boundary
   - reduce variable payload
   - scale DB/node/worker

6. Verify with before/after metrics

7. Document capacity envelope
```

Do not start with configuration changes. Start with facts.

---

## 23. What Top 1% Engineers Internalize

A strong Camunda 7 engineer does not merely know “set asyncBefore” or “increase job executor threads”. They internalize these invariants:

1. **Every durable step has DB cost.**
2. **Every async boundary creates job throughput and recovery semantics.**
3. **Every remote side effect must be idempotent.**
4. **Every process variable is storage, serialization, coupling, and possibly security risk.**
5. **Every history level is a write amplification decision.**
6. **Every tasklist/query requirement is a read model design question.**
7. **Every parallel branch can become an optimistic locking/concurrency problem.**
8. **Every scaling move shifts bottleneck somewhere else.**
9. **Every performance claim needs workload definition and evidence.**
10. **The database is the natural limit of Camunda 7 architecture.**

---

## 24. Ringkasan

Camunda 7 performance engineering harus dipahami sebagai gabungan dari:

- BPMN modelling discipline,
- transaction boundary design,
- job executor tuning,
- external task worker design,
- variable payload discipline,
- history/audit strategy,
- query/read model architecture,
- database operations,
- load testing methodology,
- observability.

Camunda 7 dapat menjalankan workload enterprise yang serius bila:

- model ramping,
- state kecil,
- query dikontrol,
- side effect idempotent,
- history di-retain dengan benar,
- job executor tidak over-tuned,
- DB diperlakukan sebagai critical shared component,
- load test merepresentasikan workflow nyata.

Bagian berikutnya akan masuk lebih operasional lagi: **Database Operations: Indexing, Cleanup, Archival, Partitioning, Vacuum/Shrink, and Maintenance Windows**.

---

## 25. Checklist Latihan

Untuk memperkuat pemahaman, coba jawab:

1. Dalam proses Anda, operasi mana yang berada di user-facing synchronous path?
2. Activity mana yang wajib async boundary karena remote side effect?
3. Variable mana yang sebenarnya hanya perlu disimpan sebagai reference id?
4. Query tasklist mana yang seharusnya pindah ke projection table?
5. Berapa rata-rata dan p95 durasi job per handler type?
6. Berapa oldest due job age saat peak load?
7. Tabel history mana yang tumbuh paling cepat?
8. Apakah history cleanup bisa mengejar growth rate harian?
9. Apa retry storm scenario paling mungkin?
10. Apa capacity envelope realistis untuk workload production Anda?

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-024.md">⬅️ DMN/CMMN in Camunda 7: Decision Automation, Case Management, and When Not to Use Them</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-026.md">Part 026 — Database Operations: Indexing, Cleanup, Archival, Partitioning, Vacuum/Shrink, and Maintenance Windows ➡️</a>
</div>
