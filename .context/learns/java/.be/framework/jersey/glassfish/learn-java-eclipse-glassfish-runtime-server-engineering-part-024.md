# learn-java-eclipse-glassfish-runtime-server-engineering-part-024  
# Part 24 — Troubleshooting Runtime Failures: Thread Dump, Heap Dump, Stuck Request, Deadlock, Timeout

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: 24 dari 35  
> Status seri: **belum selesai**  
> Target pembaca: Java backend / enterprise engineer yang sudah memahami Jakarta EE API dan ingin memahami GlassFish sebagai runtime produksi  
> Fokus part ini: **runbook diagnosis runtime failure GlassFish**: stuck request, hang, freeze, timeout, deadlock, thread starvation, pool exhaustion, CPU spike, memory pressure, deployment failure, dan evidence collection

---

## 0. Tujuan Part Ini

Setelah menyelesaikan part ini, kamu diharapkan bisa:

1. membedakan symptom, impact, contributing factor, dan root cause;
2. melakukan triage runtime incident GlassFish tanpa langsung menebak;
3. mengambil evidence yang tepat:
   - server log;
   - access log;
   - thread dump;
   - heap dump;
   - class histogram;
   - JVM report;
   - GC log;
   - JMX/metrics;
   - OS/container metrics;
4. membaca thread dump secara sistematis:
   - `RUNNABLE`;
   - `BLOCKED`;
   - `WAITING`;
   - `TIMED_WAITING`;
   - socket read;
   - DB wait;
   - lock monitor;
   - executor wait;
5. memahami stuck request, thread starvation, deadlock, timeout, pool exhaustion, dan cascading failure;
6. membangun decision tree untuk HTTP 500, 502/503/504, hang, slow request, deployment failure, dan OOME;
7. membuat incident runbook yang dapat dipakai tim produksi;
8. menghindari tindakan reaktif yang memperburuk keadaan;
9. menyusun postmortem berbasis evidence;
10. memahami boundary ownership: GlassFish vs app vs DB vs proxy vs broker vs external dependency.

Part ini tidak mengulang Part 20 Logging, Part 21 Monitoring, atau Part 23 Memory. Di sini semua digabung menjadi **diagnostic workflow**.

---

## 1. Mental Model: Troubleshooting adalah Boundary Search

Saat user berkata:

```text
Aplikasi lambat.
Aplikasi error.
GlassFish hang.
```

Itu bukan diagnosis. Itu symptom.

Top 1% engineer memecah sistem menjadi boundary:

```text
Client
  |
Reverse Proxy / Load Balancer
  |
GlassFish HTTP Listener
  |
GlassFish Thread Pool
  |
Application Code
  |
Transaction Boundary
  |
Resource Pool
  |
DB / JMS / EIS / External API
  |
OS / JVM / Network
```

Pertanyaan utama:

```text
Boundary mana yang menolak, melambat, penuh, atau berhenti?
```

Jangan mulai dari tebakan seperti:

```text
Pasti DB.
Pasti GC.
Pasti thread kurang.
Pasti GlassFish bug.
```

Mulai dari evidence.

---

## 2. Symptom vs Root Cause

### 2.1 Symptom

Yang terlihat:

```text
HTTP 504
request lambat
thread pool full
JDBC pool exhausted
CPU tinggi
heap penuh
deployment failed
server tidak response
```

### 2.2 Contributing Factor

Faktor yang memperburuk:

```text
timeout terlalu panjang
pool terlalu besar
retry terlalu agresif
query tidak punya index
log DEBUG aktif
session terlalu besar
```

### 2.3 Root Cause

Penyebab dasar:

```text
DB lock akibat transaksi panjang
ThreadLocal leak setelah redeploy
external API timeout menyebabkan HTTP thread habis
deadlock pada synchronized block
credential DB expired
wrong JNDI target pada cluster
```

Contoh:

```text
Symptom:
  HTTP 504

Contributing factor:
  proxy timeout 60s, app external timeout 120s

Root cause:
  external API tidak merespons dan app menahan HTTP threads menunggu call
```

---

## 3. Incident Triage: 5 Menit Pertama

Dalam 5 menit pertama, kumpulkan jawaban:

```text
1. Apa impact user?
2. Kapan mulai?
3. Semua endpoint atau endpoint tertentu?
4. Semua instance atau satu instance?
5. Semua user atau user tertentu?
6. Ada deployment/config change?
7. Error code dominan apa?
8. CPU/memory/thread/pool saturation?
9. DB/JMS/external dependency sehat?
10. Apakah perlu mitigasi cepat sebelum root cause lengkap?
```

Evidence cepat:

```text
- access log/error rate
- server.log recent SEVERE/WARNING
- metrics dashboard
- thread dump if hang/slow
- DB active sessions if DB suspected
- recent deployment history
```

---

## 4. Jangan Kehilangan Evidence

Restart sering menyelesaikan symptom sementara, tapi menghapus evidence.

Sebelum restart jika situasi memungkinkan:

```bash
asadmin generate-jvm-report --type=thread > thread-report.txt
jcmd <pid> Thread.print > thread-dump.txt
jcmd <pid> GC.class_histogram > class-histo.txt
jcmd <pid> VM.native_memory summary > nmt.txt
```

Ambil:

```text
server.log
access log
GC log
metrics snapshot
thread dump 3 kali dengan interval 10–30 detik
```

Jika service total down dan SLA kritikal, restore service lebih prioritas. Tapi jika bisa, ambil minimal thread dump dan logs dulu.

---

## 5. GlassFish JVM Report

GlassFish menyediakan command:

```bash
asadmin generate-jvm-report
```

Jenis laporan umum:

```bash
asadmin generate-jvm-report --type=summary
asadmin generate-jvm-report --type=thread
asadmin generate-jvm-report --type=class
asadmin generate-jvm-report --type=memory
asadmin generate-jvm-report --type=log
```

Gunakan:

```bash
asadmin generate-jvm-report --type=thread --target server
```

Manfaat:

- tidak perlu langsung mencari PID;
- GlassFish-aware;
- bisa target instance;
- berguna untuk thread dump saat server freeze/sluggish.

Keterbatasan:

- server/admin path harus cukup responsif;
- jika JVM benar-benar hang berat, `jcmd`/OS signal mungkin diperlukan;
- output harus diarsipkan dengan timestamp.

---

## 6. JVM Tooling Dasar

### 6.1 `jcmd`

Tool modern serbaguna.

```bash
jcmd
jcmd <pid> Thread.print
jcmd <pid> GC.class_histogram
jcmd <pid> GC.heap_dump /secure/heap.hprof
jcmd <pid> VM.flags
jcmd <pid> VM.system_properties
jcmd <pid> VM.native_memory summary
jcmd <pid> JFR.start name=incident settings=profile duration=5m filename=/secure/incident.jfr
```

### 6.2 `jstack`

Thread dump:

```bash
jstack -l <pid> > thread-dump.txt
```

### 6.3 `jmap`

Heap dump/histogram:

```bash
jmap -histo:live <pid>
jmap -dump:live,format=b,file=heap.hprof <pid>
```

### 6.4 `jstat`

GC quick metrics:

```bash
jstat -gcutil <pid> 1000
```

### 6.5 OS Tools

Linux:

```bash
top -H -p <pid>
ps -eLf | grep java
netstat / ss
lsof -p <pid>
free -m
df -h
dmesg
```

Kubernetes:

```bash
kubectl describe pod <pod>
kubectl logs <pod>
kubectl top pod
kubectl get events
```

---

## 7. Thread Dump: Apa yang Dicari?

Thread dump adalah snapshot semua thread.

Ia menjawab:

```text
Thread sedang melakukan apa?
Banyak thread stuck di mana?
Ada deadlock?
Ada lock contention?
Ada pool starvation?
Ada thread leak?
Ada external call yang menggantung?
```

Ambil minimal 3 dump:

```text
T0
T0 + 10s
T0 + 20s
```

Kenapa?

Satu snapshot bisa menipu. Tiga snapshot menunjukkan apakah thread bergerak atau stuck.

---

## 8. Thread State

### 8.1 `RUNNABLE`

Thread sedang runnable atau sedang native call.

Tidak selalu berarti CPU-bound. Thread di socket read kadang terlihat RUNNABLE tergantung JVM/native state.

Cek stack.

### 8.2 `BLOCKED`

Thread menunggu monitor lock Java.

Indikasi lock contention.

Cari:

```text
- waiting to lock <0x...>
- locked <0x...>
```

### 8.3 `WAITING`

Thread menunggu tanpa timeout.

Bisa normal:

- executor worker idle;
- queue consumer idle;
- condition wait.

Bisa problem jika semua worker waiting pada lock/resource tertentu.

### 8.4 `TIMED_WAITING`

Thread menunggu dengan timeout.

Contoh:

- sleep;
- wait timeout;
- socket timeout;
- pool poll;
- scheduled executor.

### 8.5 `NEW` / `TERMINATED`

Jarang relevan dalam dump produksi kecuali thread lifecycle issue.

---

## 9. Normal Thread yang Tidak Perlu Dikhawatirkan

Thread dump besar bisa menakutkan. Banyak thread normal:

```text
GC threads
JIT compiler threads
Finalizer/Reference Handler
Signal Dispatcher
GlassFish admin idle threads
HTTP acceptor/selector idle
executor workers waiting on queue
JMS consumers waiting for messages
timer threads waiting
```

Jangan menganggap semua `WAITING` buruk. Konteks penting.

---

## 10. Thread Dump Pattern: HTTP Threads Waiting on JDBC Pool

Gejala:

```text
HTTP threads busy
latency tinggi
JDBC pool active=max
connection wait increasing
```

Thread stack mungkin menunjukkan:

```text
at com.sun.gjc.spi.base.AbstractDataSource.getConnection(...)
at ...
at CaseRepository.find(...)
```

Interpretasi:

```text
Request threads menunggu koneksi DB.
```

Kemungkinan root cause:

- DB query lambat;
- connection leak;
- pool terlalu kecil;
- transaction terlalu panjang;
- traffic spike;
- DB locks;
- DB sessions exhausted.

Tindakan:

```text
Cek DB active sessions dan lock.
Cek pool metrics.
Cek apakah connections returned.
Jangan langsung menaikkan pool tanpa DB capacity check.
```

---

## 11. Thread Dump Pattern: HTTP Threads in Socket Read External API

Stack:

```text
java.net.SocketInputStream.socketRead0
sun.nio.ch.SocketChannelImpl.read
okhttp3.internal...
org.apache.http...
java.net.http...
```

Interpretasi:

```text
HTTP request thread sedang menunggu external API.
```

Cek:

- timeout configured?
- external dependency latency?
- retry storm?
- connection pool external client?
- circuit breaker?
- apakah DB transaction sedang terbuka saat menunggu?

Mitigation:

- lower timeout;
- fail fast;
- async/offload;
- circuit breaker;
- isolate endpoint;
- remove external call from DB transaction.

---

## 12. Thread Dump Pattern: Lock Contention

Stack:

```text
"thread-1" BLOCKED
  waiting to lock <0x123> owned by "thread-2"

"thread-2"
  locked <0x123>
```

Cari owner lock.

Common causes:

- synchronized global cache;
- singleton EJB lock;
- static lock;
- logging lock;
- lazy initialization;
- XML parser factory/global lock;
- custom rate limiter.

Jika banyak thread BLOCKED pada satu lock:

```text
one critical section serializes workload
```

Solusi:

- reduce lock scope;
- use concurrent structures;
- shard lock;
- avoid IO inside lock;
- avoid DB/external call inside lock.

---

## 13. Deadlock

JVM thread dump dapat mendeteksi Java monitor deadlock.

Output biasanya:

```text
Found one Java-level deadlock:
...
```

Classic:

```text
Thread A holds lock1, waits lock2.
Thread B holds lock2, waits lock1.
```

Tindakan:

```text
1. Capture full thread dump.
2. Identify locks and code paths.
3. Mitigate by restart if system stuck.
4. Fix lock ordering.
5. Add tests/static analysis where possible.
```

Deadlock bisa juga terjadi di DB, bukan Java monitor.

DB deadlock terlihat di DB error/log, bukan selalu thread dump.

---

## 14. Thread Starvation

Thread starvation terjadi saat semua worker sibuk/menunggu sehingga request baru tidak dilayani.

Symptoms:

```text
HTTP requests queued/time out
busy threads=max
CPU may be low
no free worker
```

Common causes:

- slow DB;
- external API hang;
- long report/export on request thread;
- file upload/download blocking;
- deadlock/lock contention;
- too many long transactions;
- unbounded synchronous work.

Mitigation:

- isolate long-running endpoints;
- set timeouts;
- cap concurrency;
- async job;
- separate executor/pool;
- backpressure;
- fix downstream.

---

## 15. CPU Spike Diagnosis

If CPU high:

```text
1. top -H -p <pid>
2. identify high CPU thread native id
3. convert nid to hex
4. find in thread dump
```

Example:

```bash
top -H -p 12345
printf "%x\n" 6789
grep -i "0x1a85" thread-dump.txt
```

Then inspect stack.

Common causes:

- infinite loop;
- regex catastrophic backtracking;
- JSON/XML serialization;
- crypto/compression;
- report generation;
- GC CPU;
- logging storm;
- busy spin;
- high allocation.

Use JFR/async-profiler for deeper CPU profiling.

---

## 16. GC Pause Diagnosis

Symptoms:

```text
all requests stall briefly
latency spikes across endpoints
CPU may show GC
GC log shows long pause
```

Evidence:

- GC log timestamp aligns with latency spike;
- access log latency spike;
- JVM GC metrics;
- JFR.

Don't blame GC if:

```text
GC pauses are 20ms but request latency is 30s.
```

Then bottleneck is elsewhere.

---

## 17. Heap Dump Use in Runtime Failure

Heap dump is for memory/root reachability, not for every timeout.

Use when:

- heap after GC increasing;
- OOME;
- suspected leak/bloat;
- large session/cache;
- classloader leak;
- unknown retained memory.

Not first tool for:

- DB timeout;
- 504;
- CPU spike;
- deadlock;
- external API hang.

Heap dump can pause and contain sensitive data.

---

## 18. Stuck Request

A stuck request is one that remains active beyond expected time.

Causes:

```text
DB query/lock
external API wait
JMS send wait
file IO
deadlock
lock contention
infinite loop
GC pause
large response generation
thread pool starvation
```

Evidence:

```text
access log: long duration
application log: start without end
thread dump: stack of request thread
correlation ID
DB active SQL
external dependency logs
```

Runbook:

```text
1. Identify correlation ID/path/user/time.
2. Find request thread if possible.
3. Take 3 thread dumps.
4. Check if same thread stack unchanged.
5. Check DB/external call in stack.
6. Check pool metrics.
7. Check transaction timeout.
8. Decide mitigation.
```

---

## 19. HTTP 500 Diagnosis

HTTP 500 means app/server returned internal error.

Runbook:

```text
1. Search access log by timestamp/path/status.
2. Get correlation/error ID.
3. Search application logs.
4. Search server.log for SEVERE/WARNING.
5. Expand nested exception.
6. Classify:
   - application exception
   - deployment/classloading
   - resource lookup
   - DB/JMS/transaction
   - security/runtime
7. Reproduce if possible.
8. Fix root cause.
```

Common root causes:

- null pointer/business bug;
- JNDI resource missing;
- transaction rollback;
- DB constraint/timeout;
- CDI/EJB exception;
- classloading conflict;
- serialization error;
- template rendering error.

---

## 20. HTTP 502 / 503 / 504 Diagnosis

These often come from proxy/load balancer, not directly from app.

### 20.1 502 Bad Gateway

Possible:

- backend connection refused;
- backend closed connection;
- invalid response;
- TLS mismatch;
- backend crash;
- proxy protocol mismatch.

### 20.2 503 Service Unavailable

Possible:

- no healthy backend;
- readiness down;
- overloaded server;
- maintenance;
- app not deployed;
- listener unavailable.

### 20.3 504 Gateway Timeout

Possible:

- backend took too long;
- request reached GlassFish but did not finish before proxy timeout;
- network stall.

Runbook:

```text
1. Check proxy logs.
2. Check whether request reached GlassFish access log.
3. Check GlassFish thread/pool metrics.
4. Check app logs by correlation ID.
5. Check DB/external dependency.
6. Check timeout alignment.
```

---

## 21. Deployment Failure Diagnosis

Deployment failures often hide nested causes.

Symptoms:

```text
asadmin deploy failed
app not listed
app disabled
server.log SEVERE
```

Common causes:

- class not found;
- duplicate classes;
- `javax`/`jakarta` mismatch;
- CDI unsatisfied/ambiguous dependency;
- JPA persistence unit failure;
- missing JDBC resource;
- descriptor invalid;
- EJB reference unresolved;
- security role mapping issue;
- resource adapter unavailable;
- Java version bytecode mismatch;
- annotation scanning failure.

Runbook:

```text
1. Capture deploy command and output.
2. Check server.log around deployment timestamp.
3. Find first root cause, not last wrapper.
4. Check app artifact content.
5. Check GlassFish/JDK/Jakarta version compatibility.
6. Check resources/JNDI target.
7. Check descriptor XML validity.
8. Deploy to clean local/test domain if needed.
```

---

## 22. Classloading Failure Diagnosis

Errors:

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
NoSuchFieldError
LinkageError
ClassCastException
UnsupportedClassVersionError
```

Interpretation:

```text
ClassNotFoundException:
  class missing at runtime

NoClassDefFoundError:
  class was available at compile/link time or first reference but missing/failing at runtime

NoSuchMethodError:
  different library version than compiled against

ClassCastException:
  incompatible type or same class loaded by different classloaders

UnsupportedClassVersionError:
  bytecode compiled for newer Java than runtime
```

Runbook:

```text
1. Identify exact class/method.
2. Inspect WEB-INF/lib/EAR/lib/server lib.
3. Check duplicate jars.
4. Check provided APIs bundled wrongly.
5. Check javax/jakarta namespace.
6. Check Java class file version.
7. Check GlassFish version.
8. Check classloader delegation if web module.
```

---

## 23. JDBC Pool Exhaustion Diagnosis

Symptoms:

```text
HTTP latency high
threads waiting for connection
JDBC active=max
wait count increasing
transaction timeout
```

Runbook:

```text
1. Identify pool.
2. Check active/max/wait metrics.
3. Check DB sessions.
4. Check thread dumps.
5. Check connection leak logs.
6. Check long transactions.
7. Check recent traffic spike.
8. Check DB locks/slow SQL.
9. Decide whether pool size or query/transaction is root.
```

Mitigation options:

- kill problematic DB session;
- reduce traffic;
- restart leaking instance;
- rollback bad deployment;
- temporarily raise pool only if DB capacity allows;
- disable expensive endpoint;
- shorten timeout.

---

## 24. Transaction Timeout Diagnosis

Symptoms:

```text
TransactionRolledbackException
RollbackException
transaction timeout
DB work rolled back
JMS redelivery
```

Runbook:

```text
1. Identify transaction boundary.
2. Check transaction timeout setting.
3. Check operation duration.
4. Check DB lock/query.
5. Check external call inside transaction.
6. Check resource enlistment.
7. Check XA recovery/heuristic if XA.
8. Check retry/redelivery side effects.
```

Common bug:

```text
Open transaction -> call external API -> wait 30s -> transaction timeout
```

Fix:

```text
Move external call outside transaction or use outbox/saga.
```

---

## 25. JMS Stuck / Backlog Diagnosis

Symptoms:

```text
queue depth grows
oldest message age high
consumers active but slow
redelivery count high
dead message count grows
```

Runbook:

```text
1. Identify destination.
2. Check enqueue/dequeue rate.
3. Check consumer count.
4. Check MDB/app logs.
5. Check transaction rollback.
6. Check DB/external dependency used by consumer.
7. Check poison message.
8. Check broker health.
9. Decide scale/drain/pause producer.
```

Do not blindly increase consumers if DB/external dependency is bottleneck.

---

## 26. Security/Auth Failure Diagnosis

### 26.1 401

Check:

```text
credential present?
auth mechanism?
realm name?
user exists?
password/hash?
proxy stripped Authorization?
session expired?
```

### 26.2 403

Check:

```text
principal exists?
groups returned?
role required?
role mapping?
default principal-role mapping?
case sensitivity?
```

### 26.3 TLS Failure

Check:

```text
certificate expired?
truststore?
hostname/SAN?
protocol/cipher?
client cert required?
```

Use:

```bash
openssl s_client -connect host:port -showcerts
keytool -list -v -keystore ...
```

---

## 27. Disk / File Descriptor Failure

Symptoms:

```text
deployment fails
logging stops
server unstable
Too many open files
No space left on device
```

Check:

```bash
df -h
du -sh domains/domain1/logs
lsof -p <pid> | wc -l
ulimit -n
```

Causes:

- log rotation missing;
- heap dumps filled disk;
- temp files not cleaned;
- file leak;
- too many sockets;
- upload temp files;
- access log growth.

Mitigation:

- clean/archive logs carefully;
- increase disk;
- fix rotation;
- close file/socket leak;
- monitor file descriptors.

---

## 28. Network/DNS Failure

Symptoms:

```text
intermittent external call failure
UnknownHostException
Connection timed out
Connection refused
TLS handshake timeout
```

Check:

```bash
nslookup / dig
curl from same host/pod
telnet/nc to port
ss -tanp
route/firewall/security group
DNS cache
proxy settings
```

Thread dump:

```text
socketRead
socketConnect
InetAddress lookup
```

GlassFish/app server can be healthy while dependency DNS/network fails.

---

## 29. Recent Change Analysis

Always ask:

```text
What changed?
```

Possible changes:

- app deployment;
- GlassFish config;
- JVM version/options;
- DB migration;
- DB credential;
- certificate;
- LDAP/IAM;
- DNS;
- firewall/security group;
- proxy timeout;
- external API;
- traffic pattern;
- feature flag;
- batch schedule;
- logging level;
- monitoring/APM agent.

Maintain change timeline.

Many incidents are change-induced.

---

## 30. Evidence Bundle

For serious incident, collect bundle:

```text
timestamped server.log
access log slice
GC log slice
thread dumps x3
class histogram
JVM flags
GlassFish JVM report
metrics screenshots/export
deployment version
domain config diff
DB session/lock snapshot
proxy logs
Kubernetes events if applicable
```

Do not include secrets in shared bundle.

---

## 31. Incident Timeline

Build timeline:

```text
10:00 deployment started
10:05 new version ready
10:12 error rate increased
10:15 JDBC pool wait increased
10:17 HTTP p95 crossed SLO
10:20 first 504 reported
10:23 thread dump shows DB lock wait
10:30 rollback started
10:38 error rate normalized
```

Timeline prevents vague postmortem.

---

## 32. Root Cause Statement

Bad:

```text
System was slow because DB.
```

Better:

```text
Case search endpoint introduced an unindexed query on CASE_AUDIT.CREATED_DATE.
Under peak traffic, Oracle active sessions waited on full table scan and IO.
GlassFish JDBC pool reached max 40 connections, causing HTTP worker threads to wait for connections.
Proxy timed out at 60s, producing 504 for users.
```

Good root cause includes:

- trigger;
- mechanism;
- impact path;
- why existing controls failed.

---

## 33. Mitigation vs Fix

Mitigation restores service:

```text
restart instance
rollback deployment
disable endpoint
increase timeout temporarily
kill DB session
scale consumers down/up
pause producer
```

Fix prevents recurrence:

```text
add index
shorten transaction
add timeout
implement circuit breaker
fix leak
change pool config
add test
add alert
improve rollout
```

Do not confuse mitigation with fix.

---

## 34. Decision Tree: Server Not Responding

```text
Can ping host/pod?
  no -> infrastructure/network

Port open?
  no -> process/listener down

Admin asadmin works?
  no -> DAS/admin issue or JVM hang

HTTP access log receives request?
  no -> proxy/listener/routing

Thread dump obtainable?
  no -> JVM/OS severe hang

Thread dump shows all HTTP threads busy?
  yes -> thread starvation

CPU high?
  yes -> CPU/GC/spin

CPU low and threads waiting?
  yes -> downstream wait/lock/pool
```

---

## 35. Decision Tree: Slow Only One Endpoint

```text
Only one endpoint slow?
  |
  |-- Check app log duration by operation
  |-- Check DB query for that endpoint
  |-- Check external calls used only there
  |-- Check locks/synchronized section
  |-- Check payload size
  |-- Check report/export generation
  |-- Check authorization/LDAP if endpoint-specific
```

Likely application/business path issue, not global GlassFish tuning.

---

## 36. Decision Tree: Slow All Endpoints

```text
All endpoints slow?
  |
  |-- CPU high?
  |     |-- profile CPU/GC
  |
  |-- HTTP threads saturated?
  |     |-- thread dump
  |
  |-- JDBC pool saturated?
  |     |-- DB analysis
  |
  |-- GC pause?
  |     |-- GC log
  |
  |-- proxy/network?
  |     |-- proxy logs
  |
  |-- recent deployment?
        |-- rollback/compare
```

Global slowness often indicates shared bottleneck.

---

## 37. Decision Tree: Intermittent Timeout

```text
Intermittent?
  |
  |-- traffic spike pattern?
  |-- scheduled batch overlaps?
  |-- DB maintenance?
  |-- GC periodic?
  |-- external API intermittent?
  |-- DNS/cache?
  |-- connection pool validation?
  |-- lock contention under specific data?
  |-- retry storm?
```

Intermittent incidents require time-series correlation.

---

## 38. Safe Production Actions

Safer:

```text
lower traffic via LB
remove bad instance from rotation
disable feature flag
rollback deployment
reduce consumer concurrency
pause batch
capture thread dumps
raise targeted log level briefly
```

Riskier:

```text
increase all pools
enable DEBUG globally
restart all instances at once
clear DB sessions blindly
delete temp/log files without checking
kill broker
change transaction timeout without understanding
```

---

## 39. Troubleshooting Checklist by Boundary

### Proxy/LB

```text
502/503/504?
upstream health?
timeout?
connection refused?
TLS?
request reaches backend?
```

### GlassFish Listener

```text
port open?
listener enabled?
thread pool?
access log?
TLS?
```

### Application

```text
correlation ID?
exception?
slow operation?
lock?
payload?
```

### Resource Pool

```text
JDBC/connector active max?
wait queue?
leak?
validation failure?
```

### DB

```text
active sessions?
locks?
slow SQL?
CPU/IO?
connection limit?
```

### JMS

```text
queue depth?
consumer count?
redelivery?
DLQ?
broker health?
```

### JVM

```text
CPU?
GC?
heap?
thread count?
deadlock?
native memory?
```

### OS/Container

```text
OOMKilled?
disk?
file descriptors?
network?
CPU throttling?
```

---

## 40. Postmortem Template

```text
Title:
  Short incident name

Impact:
  User/business impact
  Duration
  Severity

Timeline:
  Chronological facts

Detection:
  How detected
  What alert was missing/late

Root Cause:
  Mechanism, not vague label

Trigger:
  What changed or occurred

Contributing Factors:
  Timeouts, missing alert, config, process gap

Resolution:
  Mitigation steps

Corrective Actions:
  Code
  Config
  Monitoring
  Process
  Test

What Went Well:
  ...

What Went Poorly:
  ...

Follow-up Owners/Dates:
  ...
```

---

## 41. Practice Scenario 1: 504 During Peak

```text
Symptom:
  Users report 504 on case search.

Evidence:
  Proxy timeout 60s.
  GlassFish access log shows requests completing after 80s.
  Thread dump shows many HTTP threads waiting for JDBC connections.
  JDBC pool active=max.
  DB shows full table scan on CASE_AUDIT.
```

Diagnosis:

```text
Root cause likely slow/unindexed DB query causing JDBC pool saturation and HTTP thread starvation.
```

Mitigation:

```text
rollback query change or disable endpoint
add temporary index if validated
reduce traffic/report usage
```

Fix:

```text
query/index optimization
pool/timeout alignment
load test with realistic data
alert on JDBC wait
```

---

## 42. Practice Scenario 2: CPU 100%

```text
Symptom:
  One instance CPU 100%, others normal.

Evidence:
  top -H identifies one hot thread.
  Thread dump shows regex matching in request validation.
  Same stack across dumps.
```

Diagnosis:

```text
Catastrophic regex backtracking for specific input.
```

Mitigation:

```text
remove instance from LB
block bad input pattern
restart if needed
```

Fix:

```text
replace regex
add input length limit
add unit/performance test
add request timeout/rate limit
```

---

## 43. Practice Scenario 3: Metaspace OOME After Redeploys

```text
Symptom:
  After several redeploys, Metaspace OOME.

Evidence:
  classloader stats show old app classloaders.
  heap dump path: MBeanServer -> app MBean -> app classloader.
```

Diagnosis:

```text
Application registers MBean and fails to unregister on undeploy.
```

Mitigation:

```text
restart instances during deployment.
```

Fix:

```text
unregister MBean in shutdown hook managed by container lifecycle.
avoid hot redeploy until fixed.
```

---

## 44. Practice Scenario 4: JMS Backlog

```text
Symptom:
  Queue depth grows, consumers active.

Evidence:
  Redelivery count increasing.
  Consumer logs show transaction rollback due to DB deadlock.
```

Diagnosis:

```text
Consumer cannot commit messages because DB deadlock triggers rollback/redelivery.
```

Mitigation:

```text
pause producer if backlog threatens SLA
fix/kill DB lock
route poison messages if needed
```

Fix:

```text
shorten transaction
fix lock ordering/index
idempotent consumer
DLQ policy
alert on redelivery
```

---

## 45. Practice Scenario 5: Works in DEV, Fails in UAT

```text
Symptom:
  App deploys in DEV but fails in UAT cluster.

Evidence:
  NameNotFoundException jdbc/case/main.
  Resource exists on server target, not cluster target.
```

Diagnosis:

```text
Resource target mismatch.
```

Fix:

```text
create/target resource for cluster config.
add deployment precheck.
```

---

## 46. Troubleshooting Maturity Model

### Level 1 — Reactive

```text
Restart server.
Hope issue disappears.
```

### Level 2 — Log-Based

```text
Search server.log.
Find stack trace.
```

### Level 3 — Metrics-Aware

```text
Use dashboards for CPU/memory/pools.
```

### Level 4 — Evidence-Driven

```text
Correlate logs, metrics, dumps, DB/broker evidence.
```

### Level 5 — Preventive

```text
Runbooks, alerts, load tests, fault injection, postmortem action tracking.
```

Goal: Level 5.

---

## 47. Top 1% Takeaways

1. **Troubleshooting is boundary search.**
2. **Restart may restore service but destroys evidence.**
3. **Take multiple thread dumps, not just one.**
4. **Thread state alone is insufficient; stack context matters.**
5. **HTTP 504 is often proxy symptom, not root cause.**
6. **Thread starvation often comes from downstream wait, not too few threads.**
7. **Pool exhaustion is a symptom; ask why resources are held.**
8. **Root cause statements must explain mechanism and impact path.**
9. **Mitigation and fix are different.**
10. **Runbooks and evidence bundles turn hero debugging into team capability.**

---

## 48. Mini Exercise

You receive this incident:

```text
At 14:05, users report slow login and intermittent 504.
At 14:10, dashboard shows HTTP busy threads 95%.
CPU is 35%.
Heap is normal.
JDBC pool loginDS active is low.
LDAP auth latency not monitored.
Thread dump shows many threads in socketRead under LDAP client library.
Proxy timeout is 60s.
App LDAP timeout is 120s.
```

Answer:

1. What is the likely boundary?
2. Why is CPU low?
3. Why are HTTP threads busy?
4. Why does proxy return 504?
5. What immediate mitigation is safe?
6. What config fix is needed?
7. What monitoring was missing?
8. What runbook should be added?
9. What should not be done?
10. How would you prove the root cause?

---

## 49. Referensi

Referensi utama:

- Eclipse GlassFish Troubleshooting Guide, Release 7  
  https://glassfish.org/docs/7.1.0/troubleshooting-guide.pdf

- Eclipse GlassFish Reference Manual, Release 8 — `generate-jvm-report`  
  https://glassfish.org/docs/latest/reference-manual.html

- Eclipse GlassFish Administration Guide, Release 8  
  https://glassfish.org/docs/latest/administration-guide.html

- Eclipse GlassFish Performance Tuning Guide, Release 8  
  https://glassfish.org/docs/latest/performance-tuning-guide.html

- Java `jcmd`, `jstack`, `jmap`, `jstat` Tool Documentation  
  https://docs.oracle.com/en/java/javase/

- Java Flight Recorder / JDK Mission Control Documentation  
  https://docs.oracle.com/javacomponents/jmc-5-5/jfr-runtime-guide/about.htm

---

## 50. Status Seri

Part ini selesai.

Progress:

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
Part 22 - selesai
Part 23 - selesai
Part 24 - selesai
```

Seri belum selesai.

Part berikutnya:

```text
Part 25 — Clustering, Load Balancing, Session Replication, dan High Availability
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-023.md">⬅️ Part 23 — Memory, GC, Native Memory, Class Metadata, dan Leak Diagnosis</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-025.md">Part 25 — Clustering, Load Balancing, Session Replication, dan High Availability ➡️</a>
</div>
