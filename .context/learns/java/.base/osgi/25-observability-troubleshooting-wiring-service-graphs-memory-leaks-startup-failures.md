# Part 25 — Observability and Troubleshooting: Wiring Graphs, Service Graphs, Memory Leaks, Startup Failures

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `25-observability-troubleshooting-wiring-service-graphs-memory-leaks-startup-failures.md`  
> Scope: Java 8 sampai Java 25  
> Level: Advanced / production engineering / platform troubleshooting

---

## 0. Tujuan pembelajaran

Pada part sebelumnya kita sudah membahas testing OSGi. Testing memberi keyakinan sebelum deployment. Namun pada runtime production, sistem tetap bisa masuk ke kondisi yang tidak sepenuhnya bisa ditangkap oleh test:

- bundle resolve di local tetapi gagal di runtime distribution;
- bundle `ACTIVE` tetapi service yang dibutuhkan tidak tersedia;
- Declarative Services component tidak aktif karena reference/config belum satisfy;
- update bundle membuat classloader lama tertahan oleh thread, cache, listener, atau static reference;
- service diganti secara dinamis lalu client masih memakai stale object;
- refresh package mengubah wiring dan menimbulkan efek domino;
- startup lambat karena extender scanning, DS activation, config wait, atau dependency graph yang terlalu besar;
- readiness probe hijau padahal domain capability belum siap;
- hot deployment berhasil secara command-line tetapi runtime behavior berubah non-deterministik.

Tujuan part ini adalah membangun kemampuan **membaca runtime OSGi sebagai sistem hidup**. Bukan hanya melihat log error, tetapi memahami graph yang berjalan:

1. bundle graph;
2. package wiring graph;
3. service graph;
4. DS component graph;
5. configuration graph;
6. thread/executor graph;
7. classloader reachability graph;
8. deployment/provisioning graph.

Setelah mempelajari part ini, kamu diharapkan mampu:

- membedakan masalah resolver, lifecycle, DS, configuration, classloading, dan domain readiness;
- membuat runbook troubleshooting yang reproducible;
- mendesain observability OSGi dari awal, bukan menambah log ketika incident terjadi;
- membaca gejala `INSTALLED`, `RESOLVED`, `ACTIVE`, `UNSATISFIED`, `REGISTERED`, `UNREGISTERED`, dan `STALE` secara tepat;
- mendiagnosis classloader leak setelah bundle update/refresh;
- membangun health/readiness model yang lebih akurat daripada “semua bundle ACTIVE”.

---

## 1. Mental model: observability OSGi bukan hanya log aplikasi

Dalam aplikasi Java biasa, observability sering dimodelkan sebagai:

```text
request -> service -> database -> response
```

Kita melihat:

- HTTP latency;
- error rate;
- database query time;
- JVM CPU/memory;
- logs/traces.

Di OSGi, modelnya lebih kaya:

```text
request
  -> web endpoint service
  -> DS component
  -> OSGi service reference
  -> provider bundle
  -> imported API package wire
  -> configured runtime state
  -> dynamic dependency availability
  -> external resource
```

Masalah bisa terjadi pada salah satu layer tersebut.

Contoh:

```text
HTTP 503
```

Bisa berarti:

- servlet belum teregister;
- servlet bundle `ACTIVE`, tetapi DS component servlet unsatisfied;
- DS component satisfied, tetapi config invalid;
- service dependency optional tetapi sebenarnya required secara domain;
- provider service ada tetapi kalah ranking;
- API package consumer dan provider wired ke versi berbeda;
- endpoint registered di context path berbeda;
- readiness probe hanya mengecek JVM hidup, bukan endpoint siap;
- old bundle masih melayani request setelah update karena thread pool belum drain.

Maka OSGi observability harus menjawab pertanyaan berikut:

```text
1. Bundle apa yang ada di runtime?
2. Bundle apa state-nya?
3. Bundle mana wired ke package provider mana?
4. Service apa yang registered?
5. Service consumer mana bound ke provider mana?
6. DS component mana satisfied/active/unsatisfied?
7. Config PID mana yang effective?
8. Thread mana masih menjalankan class dari classloader bundle lama?
9. Apakah runtime state sesuai deployment intent?
10. Apakah domain capability sudah siap, bukan sekadar bundle ACTIVE?
```

---

## 2. OSGi runtime planes

Untuk troubleshooting yang rapi, pisahkan OSGi runtime menjadi beberapa plane.

```text
+---------------------------------------------------------------+
| Domain Plane                                                  |
| business capability, workflow, validation, connector behavior  |
+---------------------------------------------------------------+
| Service Plane                                                 |
| service registry, ranking, LDAP filter, DS binding             |
+---------------------------------------------------------------+
| Component Plane                                               |
| DS/Blueprint/CDI component state, activation, config           |
+---------------------------------------------------------------+
| Module Plane                                                  |
| bundles, package imports/exports, wiring, resolver             |
+---------------------------------------------------------------+
| Lifecycle Plane                                               |
| install, resolve, start, stop, update, refresh, start levels   |
+---------------------------------------------------------------+
| Runtime Plane                                                 |
| JVM, classloaders, threads, heap, native memory, GC             |
+---------------------------------------------------------------+
| Provisioning Plane                                            |
| bndrun, Karaf features, p2, Docker image, repo, config source  |
+---------------------------------------------------------------+
```

A common mistake is jumping directly from a domain symptom to a code fix.

Top-tier troubleshooting asks:

```text
Which plane is inconsistent?
```

Example:

```text
Symptom: Validation rule does not run.
```

Possible planes:

| Plane | Question |
|---|---|
| Provisioning | Is the rule plugin bundle actually installed? |
| Lifecycle | Is it `ACTIVE`? |
| Module | Is it resolved with the intended API package version? |
| Component | Is the rule component satisfied? |
| Service | Is the rule service registered with correct properties? |
| Domain | Does the rule match the case type/status? |
| Runtime | Is the worker thread still using old rule service snapshot? |

---

## 3. Observability minimum set for an OSGi runtime

A production-grade OSGi system should expose at least:

1. **Bundle inventory**
   - bundle id;
   - symbolic name;
   - version;
   - location;
   - state;
   - start level;
   - last modified/update time;
   - fragment/host relationship.

2. **Wiring inventory**
   - imported packages;
   - exported packages;
   - provider bundle for each import;
   - unresolved requirements;
   - `uses` constraint context;
   - capabilities/requirements.

3. **Service inventory**
   - service id;
   - object classes;
   - provider bundle;
   - using bundles;
   - ranking;
   - properties;
   - scope.

4. **DS component inventory**
   - component name;
   - state;
   - bundle;
   - provided services;
   - references;
   - bound target;
   - unsatisfied reason;
   - configuration PID.

5. **Configuration inventory**
   - PID/factory PID;
   - source;
   - version/revision;
   - effective values minus secrets;
   - validation state;
   - last update time.

6. **Runtime metrics**
   - JVM memory;
   - class count;
   - classloader count;
   - thread count;
   - executor queue;
   - event queue;
   - service churn;
   - bundle restart count;
   - activation duration.

7. **Lifecycle events**
   - bundle installed/updated/started/stopped/uninstalled;
   - framework start/stop/error events;
   - service registered/modified/unregistered;
   - DS activate/deactivate/modified failure;
   - configuration change events.

8. **Health/readiness status**
   - framework running;
   - required bundles resolved/active;
   - required DS components active;
   - required services bound;
   - required configs valid;
   - required external dependencies reachable;
   - domain capability ready.

---

## 4. Bundle state is necessary but not sufficient

OSGi bundle lifecycle state is important, but it is not the whole truth.

Typical states:

```text
INSTALLED -> RESOLVED -> STARTING -> ACTIVE -> STOPPING -> RESOLVED
```

Meaning:

| State | Meaning | Common misunderstanding |
|---|---|---|
| `INSTALLED` | Bundle exists but requirements are not resolved | “Installed means usable” |
| `RESOLVED` | Class/package requirements resolved | “Resolved means service ready” |
| `STARTING` | Activation in progress | “It should be instant” |
| `ACTIVE` | Bundle has started | “All components are ready” |
| `STOPPING` | Deactivation in progress | “No code is running anymore” |
| `UNINSTALLED` | Removed from framework | “All classes are GC-ed” |

Important invariant:

```text
ACTIVE bundle != active DS components != registered services != domain readiness.
```

Example:

```text
Bundle: com.example.case.validation.plugin
State : ACTIVE
```

But DS says:

```text
Component: com.example.case.validation.HighRiskRule
State    : UNSATISFIED_REFERENCE
Missing  : com.example.case.api.RiskScoringService
```

In this case, bundle lifecycle is okay, but component graph is not.

---

## 5. Bundle-level troubleshooting flow

When a bundle is not working, follow this order.

```text
1. Is the bundle installed?
2. Is the symbolic name/version the expected one?
3. Is it a host bundle or fragment?
4. Is it resolved?
5. If not resolved, which requirement is missing?
6. Is it active?
7. If not active, did activator/component activation fail?
8. Does it register expected services?
9. Are consumers using those services?
10. Is it wired to the intended API/library versions?
```

### 5.1 Bundle exists but wrong version

Symptom:

```text
Bug fix deployed but behavior unchanged.
```

Check:

```text
symbolicName = com.example.case.validation
version      = 1.4.2
location     = file:/opt/runtime/bundles/com.example.case.validation-1.4.1.jar
```

The runtime may have old location/version because:

- deployment copied file but framework cache still points to old bundle;
- Karaf feature repository still references old version;
- bndrun `-runbundles` not regenerated;
- p2 profile did not update installable unit;
- Docker image contains old layer;
- bundle was updated but dependent packages not refreshed.

### 5.2 Bundle is `INSTALLED`

Usually a resolver problem.

Common causes:

- missing imported package;
- version range mismatch;
- missing required capability;
- missing execution environment;
- fragment host not found;
- native code requirement not satisfied;
- `uses` constraint violation;
- required bundle missing.

Decision:

```text
Do not debug service/component layer until module layer is resolved.
```

### 5.3 Bundle is `RESOLVED` but not `ACTIVE`

Possible causes:

- not auto-started;
- start level not reached;
- lazy activation not triggered;
- activator threw exception;
- bundle intentionally contains only API/resources;
- fragment bundle cannot be started;
- framework start sequence stopped before this level.

### 5.4 Bundle is `ACTIVE` but behavior missing

Possible causes:

- no DS runtime installed;
- `Service-Component` header missing;
- DS XML not generated/included;
- component disabled;
- component unsatisfied;
- config missing;
- service property mismatch;
- endpoint registered under different context;
- consumer LDAP filter does not match provider properties;
- service ranking chooses another provider.

---

## 6. Wiring graph observability

The wiring graph answers:

```text
When bundle A imports package p, which bundle actually provides p?
```

Example:

```text
com.example.case.web
  imports com.example.case.api;version="[2.1,3)"
  wired to com.example.case.api.bundle;version=2.2.0
```

This matters because dependency identity in OSGi is not Maven artifact identity.

A Maven tree may show:

```text
com.example:case-api:2.2.0
```

But OSGi runtime may wire to:

```text
Bundle-SymbolicName: com.example.case.api
Export-Package: com.example.case.api;version=2.1.5
```

or to a wrapped dependency with different package version.

### 6.1 What to capture from wiring graph

For each bundle:

```text
Bundle
  imports:
    package -> provider bundle -> provider package version
  exports:
    package -> package version -> using bundles
  required bundles:
    required bundle -> provider version
  required capabilities:
    namespace -> provider resource
  fragments:
    attached fragments
```

### 6.2 Why wiring graph explains weird behavior

Symptom:

```text
NoSuchMethodError: com.example.case.api.RuleContext.getTenantId()
```

Potential cause:

```text
Compile-time API: 2.2.0 includes getTenantId()
Runtime wire    : 2.1.0 does not include getTenantId()
```

OSGi resolver allowed it if import range was too wide or package version was not bumped correctly.

### 6.3 `uses:=` as diagnostic signal

A `uses` constraint violation often means:

```text
Two packages that must share a type identity are wired inconsistently.
```

Example:

```text
Bundle A imports:
  com.fasterxml.jackson.databind from Jackson 2.15
  com.example.api from API bundle that uses Jackson 2.13
```

If API exposes Jackson types in public signatures, consumer and provider must see compatible/same Jackson wiring.

Top-tier lesson:

```text
A uses constraint error is not noise. It is the resolver protecting type identity.
```

---

## 7. Service graph observability

The service graph answers:

```text
Who provides which runtime capability, and who is consuming it?
```

A service entry should expose:

```text
service.id
objectClass
provider bundle
using bundles
service.ranking
service.scope
properties
registration time
```

Example:

```text
service.id      = 1842
objectClass     = com.example.rules.ValidationRule
provider        = com.example.rules.high-risk;1.3.0
using bundles   = com.example.case.validation.engine;2.4.0
ranking         = 100
scope           = singleton
properties      = rule.code=HIGH_RISK, case.type=LICENCE, jurisdiction=SG
```

### 7.1 Service registered but not used

Possible causes:

- consumer target filter does not match;
- service property name typo;
- objectClass mismatch;
- consumer reference cardinality optional and never binds;
- another provider has higher ranking;
- component using service is unsatisfied for a different reference;
- service registered after consumer took static snapshot incorrectly.

### 7.2 Service used by unexpected bundle

Possible causes:

- API too generic;
- service properties insufficient;
- missing target filter;
- service ranking global but should be scoped;
- accidental export of internal service interface;
- multiple tenants using same registry namespace.

### 7.3 Service churn

Service churn means services frequently register/unregister/modify.

It can be normal for dynamic plugins, but dangerous if unbounded.

Metrics to capture:

```text
service.register.count
service.unregister.count
service.modify.count
service.binding.change.count
component.activate.count
component.deactivate.count
```

High churn can indicate:

- unstable config source;
- bundle repeatedly restarting;
- greedy references rebinding too often;
- health-aware service unregister/register loop;
- file watcher deploying repeatedly;
- factory components exploding.

---

## 8. DS component observability

For modern OSGi systems, DS state is usually more useful than raw bundle state.

A DS component can be:

```text
disabled
enabled
unsatisfied
satisfied
active
```

Important diagnostics:

```text
component name
bundle
state
activation objects
provided service interfaces
configuration PID
configuration policy
references
  name
  interface
  cardinality
  policy
  policy option
  target filter
  bound services
  unsatisfied reason
last activation failure
last modification failure
```

### 8.1 Bundle ACTIVE but DS component missing

Check:

- Was DS runtime installed?
- Does manifest include `Service-Component` header?
- Was component XML generated?
- Are annotations processed by bnd/maven/gradle plugin?
- Is component disabled by configuration?
- Is component inside a fragment incorrectly?
- Are classes loadable by bundle classloader?

### 8.2 Component unsatisfied due to reference

Example:

```text
Component: CaseValidationEngine
State    : UNSATISFIED_REFERENCE
Reference: RiskScoringService
Target   : (region=SG)
```

Check service registry:

```text
objectClass=RiskScoringService
properties.region=sg
```

Issue:

```text
Filter expects region=SG, provider has region=sg.
```

The code may be correct, but metadata contract failed.

### 8.3 Component unsatisfied due to config

Example:

```text
configurationPolicy = REQUIRE
PID                 = com.example.case.validation
Config missing      = true
```

Bundle can be `ACTIVE`, but component will not activate until config exists.

### 8.4 Component activation failure

Common causes:

- constructor throws;
- `@Activate` performs network call and times out;
- invalid config;
- service dependency used before fully assigned;
- static reference cycle;
- TCCL-sensitive library fails;
- class not found due to optional import;
- executor/thread creation fails;
- permission/security issue.

Rule:

```text
@Activate should validate and initialize local state, not perform indefinite external work.
```

---

## 9. Configuration observability

Configuration is part of runtime topology.

For each PID/factory PID, capture:

```text
pid
factoryPid
source
revision/version
last updated
validation status
bound components
sanitized effective values
```

### 9.1 Config exists but component not updated

Possible causes:

- PID mismatch;
- factory PID vs singleton PID confusion;
- component uses wrong `configurationPid`;
- metatype PID generated differently than expected;
- config source writes to wrong location;
- Config Admin not installed/running;
- FileInstall did not detect file;
- config update failed validation;
- component has no `@Modified` and DS recreates component differently than expected.

### 9.2 Config update causes service outage

Bad pattern:

```java
@Modified
void modified(Config config) {
    this.client = new ExternalClient(config.url(), config.token());
}
```

If new client creation fails after old client is discarded, component enters broken state.

Better pattern:

```text
1. Validate new config.
2. Build new dependency object separately.
3. Test local invariants.
4. Atomically swap immutable runtime state.
5. Close old resource after successful swap.
```

---

## 10. Startup observability

Startup failures are often hidden because logs interleave across bundles/extenders.

Capture a startup timeline:

```text
T+0000ms framework init
T+0120ms system bundle active
T+0250ms config admin active
T+0310ms DS runtime active
T+0520ms API bundles resolved
T+0700ms persistence bundle active
T+1200ms datasource registered
T+1800ms migration completed
T+2100ms validation engine component active
T+2500ms HTTP endpoint registered
T+2600ms readiness = true
```

Without timeline, troubleshooting becomes guesswork.

### 10.1 Common startup bottlenecks

| Bottleneck | Symptom | Better design |
|---|---|---|
| Heavy `BundleActivator` | Framework appears stuck | Move to DS, lazy initialize |
| Network call in `@Activate` | Startup slow/fails externally | Separate activation from readiness |
| Annotation scanning | High CPU at startup | Build-time indexing/metadata |
| Resolver over huge repo | Slow resolve | Pre-resolve distribution |
| Config wait | Component never active | Explicit required config status |
| DB migration | Readiness delayed | Migration phase visibility |
| Event replay | Startup storm | Bounded replay, checkpointing |

### 10.2 Readiness must be domain-aware

Bad readiness:

```text
JVM process is running -> ready
```

Better readiness:

```text
framework active
+ required bundles active
+ required DS components active
+ required services bound
+ required configs valid
+ database reachable
+ migration complete
+ HTTP endpoints registered
+ domain plugin set loaded
= ready
```

For plugin systems, readiness may be partial:

```text
core-ready=true
case-validation-ready=true
report-rendering-ready=false
external-connector-ready=degraded
```

---

## 11. Classloader leak observability

One of the hardest OSGi production problems is classloader leak after update/uninstall.

Expected behavior:

```text
Bundle v1 stopped/uninstalled/refreshed
=> old bundle classloader becomes unreachable
=> GC collects old classes/resources
```

Leak behavior:

```text
Bundle v1 stopped/uninstalled/refreshed
=> old classloader still reachable
=> heap/metaspace grows
=> old code may still run
```

### 11.1 Common leak roots

| Leak root | Example |
|---|---|
| Thread | Bundle starts thread and does not stop it |
| Executor | Scheduled task keeps class reference |
| Static field | Static cache holds service/object/class |
| ThreadLocal | Request context holds bundle class |
| Listener | Registered listener not unregistered |
| ServiceTracker | Tracker not closed |
| Timer | `java.util.Timer` not cancelled |
| JDBC driver | DriverManager holds driver classloader |
| Logging | Appender/filter not stopped |
| MBean | MBean not unregistered |
| TCCL | Thread context classloader points to old bundle |
| Native lib | Native library cannot unload safely |
| Serialization cache | ObjectInputStream/proxy/class cache |

### 11.2 Leak detection approach

1. Deploy bundle v1.
2. Trigger behavior.
3. Update to v2 or uninstall v1.
4. Force GC in test environment.
5. Take heap dump.
6. Search for old bundle classloader.
7. Inspect GC roots.
8. Identify retained path.
9. Fix lifecycle cleanup.
10. Add regression test.

### 11.3 Code pattern: thread cleanup

Bad:

```java
@Component
public class PollingConnector {
    private final ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();

    @Activate
    void activate() {
        executor.scheduleAtFixedRate(this::poll, 0, 1, TimeUnit.MINUTES);
    }
}
```

Problem:

```text
No @Deactivate. Executor thread survives bundle stop.
```

Better:

```java
@Component
public class PollingConnector {
    private ScheduledExecutorService executor;
    private ScheduledFuture<?> task;

    @Activate
    void activate() {
        executor = Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "case-connector-poller");
            t.setDaemon(false);
            return t;
        });
        task = executor.scheduleAtFixedRate(this::safePoll, 0, 1, TimeUnit.MINUTES);
    }

    @Deactivate
    void deactivate() throws InterruptedException {
        if (task != null) {
            task.cancel(false);
        }
        if (executor != null) {
            executor.shutdown();
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        }
    }

    private void safePoll() {
        try {
            poll();
        } catch (Throwable t) {
            // log and prevent scheduler death
        }
    }

    private void poll() {
        // external polling logic
    }
}
```

### 11.4 TCCL leak pattern

Bad:

```java
Thread.currentThread().setContextClassLoader(getClass().getClassLoader());
thirdPartyLibrary.call();
```

Better:

```java
ClassLoader previous = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(getClass().getClassLoader());
    thirdPartyLibrary.call();
} finally {
    Thread.currentThread().setContextClassLoader(previous);
}
```

Rule:

```text
Any temporary TCCL override must be restored in finally.
```

---

## 12. Refresh troubleshooting

In OSGi, updating a bundle may not immediately change all package wires. A package refresh can stop/restart affected bundles so they rewire.

This is powerful but dangerous.

### 12.1 Symptoms after update without refresh

- new JAR installed but old behavior persists;
- `NoSuchMethodError` because consumer still wired to old exporter;
- two versions of API package exist;
- provider bundle updated but consumers not rewired;
- old DS service still referenced until component rebind.

### 12.2 Refresh blast radius

Before refresh, ask:

```text
Which bundles import packages from the bundle being refreshed?
Which bundles transitively depend on those bundles?
Which services will unregister/re-register?
Which HTTP endpoints will temporarily disappear?
Which tasks/listeners need draining?
```

Refresh is not just a technical operation. It is a mini-redeployment of a dependency subgraph.

### 12.3 Production rule

```text
Do not use refresh as an ad-hoc production fix unless you understand the dependency graph and service impact.
```

Prefer:

- immutable distribution deployment;
- blue/green runtime;
- canary runtime;
- full restart for major API changes;
- explicit feature upgrade plan.

---

## 13. Logging strategy for OSGi

OSGi logging must support runtime topology.

At minimum include:

```text
timestamp
level
thread
bundle symbolic name
bundle version
component name
service id if relevant
correlation id
operation/domain id
```

Example:

```text
2026-06-18T10:15:04.123Z INFO  [case-worker-4]
  bundle=com.example.case.validation.engine version=2.4.1
  component=CaseValidationEngine
  correlationId=9f1c...
  caseId=EA-2026-000123
  msg="Selected validation rule"
  ruleCode=HIGH_RISK provider=com.example.rules.highrisk version=1.3.0 serviceId=1842
```

### 13.1 Log what changes runtime topology

Log events:

- bundle install/update/start/stop/uninstall;
- DS component activate/deactivate/modified failure;
- service register/unregister/modified;
- config change accepted/rejected;
- rule/plugin loaded/unloaded;
- endpoint registered/unregistered;
- migration started/completed;
- external connector degraded/recovered.

### 13.2 Avoid noisy lifecycle logs

Not every service event deserves INFO in a high-churn runtime.

Better:

- INFO for important domain capability changes;
- DEBUG/TRACE for low-level service churn;
- metrics for counts/rates;
- structured audit for operator-initiated changes.

---

## 14. Metrics for OSGi

Useful metric categories:

### 14.1 Bundle metrics

```text
osgi.bundle.count{state="ACTIVE"}
osgi.bundle.count{state="INSTALLED"}
osgi.bundle.start.duration
osgi.bundle.restart.count
osgi.bundle.update.count
osgi.bundle.refresh.count
```

### 14.2 Service metrics

```text
osgi.service.count{objectClass="..."}
osgi.service.register.count
osgi.service.unregister.count
osgi.service.modify.count
osgi.service.binding.change.count
osgi.service.lookup.failure.count
```

### 14.3 DS metrics

```text
osgi.ds.component.count{state="ACTIVE"}
osgi.ds.component.count{state="UNSATISFIED"}
osgi.ds.activation.duration
osgi.ds.activation.failure.count
osgi.ds.modified.failure.count
```

### 14.4 Config metrics

```text
osgi.config.count
osgi.config.update.count
osgi.config.validation.failure.count
osgi.config.bound.component.count
```

### 14.5 Runtime leak metrics

```text
jvm.classes.loaded
jvm.classes.unloaded
jvm.metaspace.used
osgi.classloader.count
osgi.bundle.old.classloader.retained.count
```

Not all frameworks expose classloader count directly, but you can derive it in controlled diagnostics or via heap inspection.

---

## 15. Tracing OSGi service calls

OSGi service calls are in-process. They do not automatically create distributed tracing spans.

But service boundaries are still meaningful.

Trace when:

- service call crosses domain boundary;
- service is plugin-provided;
- service can be dynamically substituted;
- service calls external dependency;
- service participates in workflow/case lifecycle.

Example span attributes:

```text
osgi.service.interface=com.example.rules.ValidationRule
osgi.service.id=1842
osgi.provider.bundle=com.example.rules.highrisk
osgi.provider.version=1.3.0
rule.code=HIGH_RISK
case.id=EA-2026-000123
```

Do not trace every tiny in-process service call blindly. That can create overhead/noise.

---

## 16. Runtime commands and tools

Exact commands depend on runtime, but the diagnostic categories are similar.

### 16.1 Felix / Gogo style commands

Common categories:

```text
lb / bundles         list bundles
headers             inspect manifest
inspect capability  inspect capabilities
inspect requirement inspect requirements
services            list services
start/stop/update   lifecycle operations
scr:list            list DS components
scr:info            inspect DS component
```

Apache Felix Web Console provides browser-based inspection and management of OSGi framework instances, and its REST API supports JSON retrieval for bundle information. This is useful for diagnostics automation, though production exposure must be secured tightly.

### 16.2 Karaf style commands

Common categories:

```text
bundle:list
bundle:headers
bundle:diag
bundle:tree-show
service:list
service:property
scr:list
scr:info
feature:list
feature:install
feature:repo-list
config:list
log:tail
```

Karaf adds provisioning context: feature repositories, feature state, boot features, and custom distribution state.

### 16.3 Equinox style diagnostics

Common categories:

```text
ss
bundle <id>
diag <id>
services
packages
headers
```

Equinox/p2 adds profile/installable unit context.

### 16.4 bnd/bndrun diagnostics

bnd resolver helps detect invalid runtime assembly before launch.

Use it to answer:

```text
Given these run requirements and repositories, what bundles are selected?
Are all requirements satisfied?
Which provider satisfies each capability?
What changed after dependency upgrade?
```

bndtools documentation highlights that OSGi resolver can select a valid set of bundles from a larger repository, not only wire already-installed bundles.

---

## 17. Troubleshooting playbooks

### 17.1 Bundle installed but not resolved

Symptoms:

```text
Bundle state: INSTALLED
Cannot start bundle
```

Checklist:

```text
1. Inspect unresolved requirements.
2. Check missing Import-Package.
3. Check version range mismatch.
4. Check Require-Capability.
5. Check execution environment.
6. Check fragment host.
7. Check native code requirement.
8. Check duplicate exporters and uses constraint.
9. Check repository/provisioning descriptor.
10. Fix metadata, not only classpath.
```

### 17.2 Bundle resolved but not active

Checklist:

```text
1. Is it supposed to start? API bundles may stay RESOLVED.
2. Is it a fragment? Fragments cannot be started independently.
3. Is start level reached?
4. Is lazy activation configured?
5. Did BundleActivator throw?
6. Did framework log show activation error?
7. Are required permissions/security conditions satisfied?
```

### 17.3 Bundle active but service missing

Checklist:

```text
1. Is DS runtime installed?
2. Is Service-Component header present?
3. Is component XML included?
4. Is component enabled?
5. Is component satisfied?
6. Is required config available?
7. Are references available?
8. Did activation throw?
9. Is service=false accidentally set?
10. Is service registered under expected interface?
```

### 17.4 Service registered but consumer not binding

Checklist:

```text
1. Does objectClass match reference interface?
2. Does target filter match provider properties?
3. Is cardinality optional and consumer handles absence incorrectly?
4. Is policy static and component not recreated?
5. Is another provider selected by ranking?
6. Is consumer component active?
7. Are packages wired consistently between provider and consumer?
```

### 17.5 Component flaps active/unsatisfied

Checklist:

```text
1. Is provider service unstable?
2. Is config source rewriting config repeatedly?
3. Is greedy reference rebinding frequently?
4. Does @Modified cause deactivate/activate loop?
5. Does health-aware provider unregister on transient error?
6. Is external dependency checked during activation?
7. Are multiple components depending cyclically?
```

### 17.6 `ClassCastException` between same class name

Checklist:

```text
1. Print both classloaders.
2. Identify exporting bundles for package.
3. Check duplicate embedded dependencies.
4. Check split package.
5. Check API package imported by both sides.
6. Check TCCL-based loading.
7. Check serialization/proxy class generation.
8. Fix package wiring, not casting.
```

### 17.7 `NoSuchMethodError` after deployment

Checklist:

```text
1. Identify class owner package.
2. Identify compile-time version.
3. Identify runtime package provider/version.
4. Check import range.
5. Check package version bump.
6. Check stale wiring after update.
7. Refresh/restart in controlled environment.
8. Add baseline check.
```

### 17.8 Memory grows after bundle updates

Checklist:

```text
1. Count old bundle classloaders.
2. Take heap dump after GC.
3. Inspect GC roots.
4. Look for threads/executors/timers/listeners.
5. Look for static caches and ThreadLocals.
6. Look for unclosed ServiceTrackers.
7. Look for JDBC/logging/MBean registrations.
8. Fix @Deactivate cleanup.
9. Add update/uninstall leak test.
```

---

## 18. Case study: validation plugin not running

Scenario:

```text
A new compliance validation rule plugin was deployed.
The bundle is ACTIVE.
Cases that should trigger the rule are not blocked.
```

Bad investigation:

```text
Check code -> add logs -> redeploy -> still broken.
```

Better investigation:

### Step 1: provisioning

```text
Is the expected plugin installed?
Symbolic name: com.example.rules.highrisk
Version      : 1.3.0
Location     : expected runtime repository path
```

### Step 2: lifecycle

```text
State: ACTIVE
```

Good, but not enough.

### Step 3: DS component

```text
Component: HighRiskValidationRule
State    : ACTIVE
Provides : com.example.rules.ValidationRule
```

### Step 4: service registry

```text
service.id  = 1842
objectClass = com.example.rules.ValidationRule
properties:
  rule.code = HIGH_RISK
  caseType  = licence
  stage     = REVIEW
  ranking   = 100
```

### Step 5: consumer binding

Validation engine target filter:

```text
(&(caseType=LICENCE)(stage=REVIEW))
```

Provider property:

```text
caseType=licence
```

Root cause:

```text
Case-sensitive metadata mismatch.
```

Fix:

- define enum constants/shared constants in API;
- validate service properties at activation;
- expose service graph diagnostics;
- add plugin certification test;
- add runtime warning for plugin service not selected by any consumer.

---

## 19. Case study: endpoint 404 after successful deployment

Scenario:

```text
Bundle active. Servlet code exists. Endpoint /case/api/v1/search returns 404.
```

Investigation:

1. Bundle state:

```text
ACTIVE
```

2. DS component:

```text
CaseSearchServlet: ACTIVE
```

3. HTTP Whiteboard service:

```text
Servlet registered with osgi.http.whiteboard.servlet.pattern=/api/v1/search
```

4. Context helper:

```text
context.path=/case-management
```

Actual endpoint:

```text
/case-management/api/v1/search
```

Expected endpoint:

```text
/case/api/v1/search
```

Root cause:

```text
HTTP context selection/config mismatch, not servlet code problem.
```

---

## 20. Case study: old implementation still called after update

Scenario:

```text
Updated com.example.connector.onemap from 1.1.0 to 1.2.0.
Logs still show old behavior.
```

Possible causes:

1. Bundle location still old.
2. Bundle updated but not refreshed.
3. Service provider v1 still registered.
4. Consumer cached service object manually.
5. Consumer copied service list snapshot and never updates it.
6. Old thread still running from v1 classloader.
7. Multiple providers exist and ranking selects old one.

Diagnostic flow:

```text
1. List bundle versions.
2. List services for connector interface.
3. Check provider bundle id/version for selected service.
4. Check using bundles.
5. Check thread dump for old bundle class names.
6. Check heap dump for old classloader retention.
7. Check service ranking/properties.
8. Check DS reference policy.
```

Root fix depends on finding the plane.

---

## 21. Designing OSGi health model

A good health model should distinguish:

```text
liveness  : process/framework is alive
readiness : runtime can accept traffic safely
capability: specific domain capability is usable
```

### 21.1 Liveness

Should be minimal:

```text
JVM responsive
framework not stopping
main event loop alive
```

Do not include external DB/API checks in liveness or orchestrator may restart healthy but degraded instances repeatedly.

### 21.2 Readiness

Should include required local runtime state:

```text
required bundles active
required components active
required services bound
required configs valid
HTTP endpoints registered
critical migrations complete
```

### 21.3 Capability health

Example:

```json
{
  "framework": "UP",
  "readiness": "UP",
  "capabilities": {
    "case-search": "UP",
    "case-validation": "UP",
    "report-rendering": "DEGRADED",
    "external-postal-code-lookup": "DOWN"
  }
}
```

This is far better than:

```json
{"status":"UP"}
```

---

## 22. Designing runtime inspection APIs

A secure internal admin API can expose sanitized runtime state.

Example endpoints:

```text
/internal/osgi/bundles
/internal/osgi/bundles/{id}/wiring
/internal/osgi/services
/internal/osgi/components
/internal/osgi/configs
/internal/osgi/capabilities
/internal/osgi/health
/internal/osgi/startup-timeline
```

Security requirements:

- admin-only;
- not public internet;
- redact secrets;
- audit access;
- rate-limit;
- disable mutation unless explicitly needed;
- separate read-only diagnostics from write operations.

Never expose generic OSGi shell/web console publicly.

---

## 23. Production-safe diagnostic bundles

A diagnostic bundle should:

- be read-only by default;
- expose bundle/service/component/config summaries;
- redact sensitive config;
- provide graph export;
- support correlation id;
- avoid causing service activation side effects;
- avoid retaining service objects accidentally;
- be removable without affecting business logic.

Bad diagnostic design:

```text
Diagnostic bundle obtains all services and stores them forever.
```

This can create leaks and prevent dynamic unbind.

Better:

```text
Diagnostic bundle reads ServiceReference metadata and only obtains service object when necessary, then ungets it immediately.
```

---

## 24. Java 8 to 25 observability considerations

### Java 8

- PermGen already removed before Java 8, but Metaspace exists.
- Many legacy OSGi systems still depend on Security Manager-era assumptions.
- Old libraries may use TCCL heavily.
- JAXB/JAX-WS/Activation still included in JDK 8.

### Java 9–11

- JPMS introduced strong encapsulation model.
- Java EE modules removed in Java 11.
- Many reflection-heavy libraries need explicit dependencies.
- Illegal access warnings became important migration signal.

### Java 17

- Stronger encapsulation operationally more relevant.
- Old bytecode manipulation libraries frequently fail.
- Observability agents may need `--add-opens`.

### Java 21

- Virtual threads available.
- Thread dump interpretation changes if virtual threads are used.
- OSGi components should still manage lifecycle explicitly.

### Java 24/25

- Security Manager cannot be relied on for sandboxing.
- Observability/security posture must assume in-process bundles are trusted/certified or isolated externally.
- Agents, reflection, bytecode tools, and native access need stricter review.

---

## 25. Anti-patterns

### 25.1 “All bundles ACTIVE, therefore system ready”

Wrong. DS components, service bindings, config, and domain capability may still be missing.

### 25.2 “Restart fixes it, no need root cause”

Restart clears dynamic state, stale references, classloaders, and service graph, but does not explain why they got corrupted.

### 25.3 “Expose Web Console publicly for convenience”

This is dangerous. Management surfaces can reveal runtime internals and may allow mutation.

### 25.4 “Use refresh as random fix”

Refresh can stop/restart a dependency subgraph. Without blast-radius analysis, it is risky.

### 25.5 “Cache service objects manually forever”

This breaks dynamic service semantics and can retain old classloaders.

### 25.6 “Ignore DS unsatisfied components”

An unsatisfied component may be optional, but it may also represent hidden degraded capability.

### 25.7 “Do external network calls in activation”

This couples component lifecycle to external availability and makes startup fragile.

### 25.8 “No component/config/service graph in incident report”

OSGi incident reports must include runtime graph evidence, not just logs.

---

## 26. Incident report template for OSGi production issues

Use this structure.

```text
1. Incident summary
   - what failed
   - user impact
   - start/end time
   - affected capability

2. Runtime identity
   - runtime version/image
   - framework implementation/version
   - Java version
   - deployment descriptor/feature/bndrun version

3. Bundle state
   - affected bundles
   - symbolic name/version/location
   - lifecycle state

4. Wiring state
   - relevant package imports/exports
   - provider bundles
   - version ranges
   - uses constraint notes

5. Component state
   - DS/Blueprint components
   - active/unsatisfied states
   - missing references/config

6. Service state
   - registered services
   - selected provider
   - ranking/properties
   - using bundles

7. Config state
   - PID/factory PID
   - last update
   - validation result
   - sanitized values

8. Runtime state
   - thread dump highlights
   - heap/metaspace trend
   - old classloader evidence
   - executor/event queue

9. Root cause
   - exact failed invariant

10. Remediation
    - immediate fix
    - durable fix
    - tests added
    - observability added

11. Prevention
    - checklist/pipeline/runbook changes
```

---

## 27. Design checklist

Before approving an OSGi production system, ask:

### Bundle/module observability

- Can we list all bundles with symbolic name/version/location/state?
- Can we inspect unresolved requirements?
- Can we inspect package wires?
- Can we detect duplicate package exporters?
- Can we detect stale bundle versions after deployment?

### Service observability

- Can we list services and providers?
- Can we see using bundles?
- Can we see service ranking/properties?
- Can we detect missing mandatory services?
- Can we detect service churn?

### DS/component observability

- Can we list components and states?
- Can we see unsatisfied references?
- Can we see config PID binding?
- Can we see last activation failure?
- Can we distinguish disabled vs unsatisfied?

### Config observability

- Can we see effective config without secrets?
- Can we validate config before applying?
- Can we trace config source and revision?
- Can we rollback config safely?

### Runtime observability

- Can we detect classloader leaks?
- Can we inspect thread ownership?
- Can we detect old bundle code still running?
- Can we measure activation/startup duration?

### Operational safety

- Is management console secured?
- Are mutation operations audited?
- Is refresh blast radius understood?
- Is readiness domain-aware?
- Are incident reports graph-based?

---

## 28. Key takeaways

OSGi troubleshooting is graph troubleshooting.

A mature engineer does not stop at:

```text
The bundle is ACTIVE.
```

They ask:

```text
Is it resolved to the right providers?
Are its DS components satisfied?
Are expected services registered?
Are consumers bound to the right providers?
Is config valid and effective?
Is the old classloader gone after update?
Is the domain capability ready?
```

The most important mental models from this part:

1. **Bundle state is only one layer.** `ACTIVE` is not enough.
2. **Wiring explains binary behavior.** Runtime package provider matters more than Maven compile tree.
3. **Service graph explains dynamic behavior.** Ranking, filters, properties, and churn matter.
4. **DS graph explains component readiness.** Unsatisfied references/config are first-class runtime states.
5. **Refresh has blast radius.** Treat it as controlled redeployment of a dependency subgraph.
6. **Classloader leaks are lifecycle bugs.** Threads, static caches, listeners, trackers, TCCL, JDBC, logging, and MBeans are common roots.
7. **Readiness must be capability-aware.** Framework running does not mean business capability ready.
8. **Production diagnostics must be designed, not improvised.**

---

## 29. Suggested exercises

1. Build a tiny runtime with three bundles:
   - API bundle;
   - provider bundle;
   - consumer bundle.

   Then change API version and inspect wiring before and after refresh.

2. Create a DS component with required reference. Run runtime without provider. Inspect unsatisfied state.

3. Add two providers with different `service.ranking`. Observe selected provider.

4. Add target filter mismatch. Observe why consumer does not bind.

5. Create a bundle with a scheduled executor and intentionally forget `@Deactivate`. Update/uninstall bundle and inspect thread/classloader retention.

6. Build a simple internal diagnostic endpoint that reports:
   - active bundle count;
   - unsatisfied component count;
   - required service availability;
   - readiness status.

7. Create a startup timeline log and compare before/after moving external calls out of activation.

---

## 30. References

- OSGi Core Release 8, Framework module/lifecycle/service/wiring model.
- OSGi Compendium Release 8, Declarative Services and Configuration Admin.
- Apache Felix Framework, Gogo Shell, SCR, FileInstall, and Web Console documentation.
- Apache Felix Web Console documentation and JSON bundle inspection API.
- bnd/Bndtools resolver and runtime documentation.
- Eclipse Equinox runtime and console diagnostics documentation.
- Apache Karaf manual for bundle/service/config/feature diagnostics.
- OpenJDK documentation for Java 8–25 runtime behavior, strong encapsulation, and Security Manager changes.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 24 — Testing OSGi Systems: Unit, Bundle, Resolver, Integration, and Runtime Tests](./24-testing-osgi-systems-unit-bundle-resolver-integration-runtime-tests.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 26 — Performance Engineering: Startup, Resolver Cost, Service Lookup, Classloading, Memory](./26-performance-engineering-startup-resolver-service-lookup-classloading-memory.md)
