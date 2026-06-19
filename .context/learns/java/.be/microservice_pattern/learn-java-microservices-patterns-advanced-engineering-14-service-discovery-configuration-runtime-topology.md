# Part 14 — Service Discovery, Configuration, and Runtime Topology

Series: `learn-java-microservices-patterns-advanced-engineering`  
Filename: `learn-java-microservices-patterns-advanced-engineering-14-service-discovery-configuration-runtime-topology.md`  
Target: Java 8–25, senior/principal-level microservices engineering

---

## 0. Why This Part Exists

Microservices are not only code units. They are **runtime participants** in a changing topology.

A service may be healthy at 10:00, overloaded at 10:01, scaled to five replicas at 10:02, rescheduled to another node at 10:03, connected to a new database endpoint at 10:04, and deployed with different configuration at 10:05.

If the system cannot discover services, load configuration safely, rotate secrets, react to topology changes, and avoid configuration drift, then the architecture is fragile even if the domain model is clean.

This part answers several production questions:

- How does a service find another service?
- How does a service know which environment, endpoint, limit, feature, credential, and behavior to use?
- What configuration belongs in code, environment variables, config files, config servers, Kubernetes ConfigMaps, Secrets, or external secret stores?
- How do topology changes break assumptions?
- Why is service discovery not merely “use Kubernetes DNS”?
- Why can configuration become a distributed-system risk?
- How should Java 8–25 services handle configuration and runtime topology?

The goal is to move from “my service has a URL in application.yml” to **configuration and topology as governed runtime architecture**.

---

## 1. Core Mental Model

A microservice runs inside a changing runtime environment.

That runtime environment has four major planes:

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         Runtime Environment                          │
├─────────────────────────────────────────────────────────────────────┤
│ 1. Identity Plane                                                     │
│    Who am I? Who is the caller? Which tenant/environment am I in?     │
├─────────────────────────────────────────────────────────────────────┤
│ 2. Discovery Plane                                                    │
│    Where are dependencies now? Which endpoints are alive?             │
├─────────────────────────────────────────────────────────────────────┤
│ 3. Configuration Plane                                                │
│    What behavior, limits, endpoints, flags, and policies apply?       │
├─────────────────────────────────────────────────────────────────────┤
│ 4. Control Plane                                                      │
│    How do operators change rollout, routing, scaling, flags, and      │
│    emergency behavior without editing application code?               │
└─────────────────────────────────────────────────────────────────────┘
```

A top-tier engineer does not treat these as incidental details. They are part of correctness.

Bad discovery causes:

- calls to dead instances,
- stale DNS resolution,
- uneven load distribution,
- cascading retries,
- hidden dependency on specific pods or nodes.

Bad configuration causes:

- wrong endpoints,
- insecure defaults,
- inconsistent feature behavior,
- accidental production calls from lower environments,
- broken rollout,
- impossible incident reconstruction.

Bad topology assumptions cause:

- services failing after pod rescheduling,
- overload after autoscaling,
- connection pool exhaustion,
- DNS cache issues,
- cross-zone latency surprises,
- unexpected dependency fan-out.

---

## 2. Definitions

### 2.1 Service Discovery

Service discovery is the mechanism by which a client finds runtime instances or logical endpoints of a dependency.

It answers:

```text
I need to call service X.
Where is X now?
Which instance should I call?
Is this instance healthy?
How should traffic be distributed?
```

Discovery may return:

- one hostname,
- many IP addresses,
- a virtual IP,
- a load balancer address,
- sidecar proxy address,
- service mesh route,
- region-specific endpoint,
- tenant-specific endpoint.

### 2.2 Configuration

Configuration is externally supplied data that changes service behavior without changing compiled application code.

Examples:

- dependency URLs,
- timeouts,
- pool sizes,
- feature flags,
- rate limits,
- retry limits,
- batch sizes,
- tenant policies,
- log levels,
- cache TTL,
- broker topic names,
- storage buckets,
- auth issuer URLs.

### 2.3 Secret

A secret is sensitive configuration.

Examples:

- password,
- API key,
- private key,
- token,
- signing key,
- database credential,
- mTLS certificate material.

A secret is not just “a config value with a different file name.” It needs different handling:

- access control,
- encryption at rest,
- audit,
- rotation,
- short lifetime where possible,
- limited blast radius,
- no logging,
- no accidental exposure in metrics, exceptions, heap dumps, or debug endpoints.

### 2.4 Runtime Topology

Runtime topology is the actual deployment graph at runtime.

It includes:

- service replicas,
- nodes,
- zones,
- regions,
- load balancers,
- sidecars,
- DNS records,
- service mesh routes,
- queues,
- databases,
- external APIs,
- caches,
- NAT gateways,
- proxies,
- firewalls,
- network policies.

Architecture diagrams often show a clean logical graph. Production topology is messier.

Logical architecture:

```text
A → B → C
```

Runtime topology:

```text
A-pod-1 ─┐
A-pod-2 ─┼─ kube-dns ─ service-B VIP ─ endpoints ─ B-pod-1 ─ DB proxy ─ DB writer
A-pod-3 ─┘                                ├─────── B-pod-2 ─ DB proxy ─ DB reader
                                           └─────── B-pod-3 ─ sidecar ─ egress proxy ─ external API
```

Top-tier architecture reviews both.

---

## 3. The Big Trap: Static Thinking in a Dynamic Runtime

Many teams design microservices as if the topology were static:

```yaml
case-service:
  application-service-url: http://application-service:8080
```

This may look harmless, but hidden questions remain:

- What if `application-service` has five replicas?
- What if one replica is slow but not dead?
- Who load-balances?
- Who retries?
- Who sets timeout?
- Who knows if service is ready?
- Does the JVM cache DNS forever?
- What happens during deployment?
- What happens when the service is moved to another namespace?
- What happens when the endpoint changes per tenant?
- What happens during disaster recovery?

Static configuration is acceptable only when wrapped in a clear runtime model.

The real concern is not whether the URL is in a file. The concern is whether the system has an explicit answer for:

```text
name → endpoint → instance → health → route → policy → timeout → failure behavior
```

---

## 4. Service Discovery Patterns

## 4.1 Static Endpoint Pattern

The simplest pattern is to configure a fixed endpoint:

```properties
application.client.base-url=https://application.internal.example.com
```

### Useful When

- dependency is external,
- endpoint is stable,
- load balancing is handled by DNS/LB,
- topology rarely changes,
- operational simplicity matters.

### Risks

- environment drift,
- hardcoded dependency graph,
- difficult tenant-specific routing,
- no client awareness of health,
- accidental cross-environment calls.

### Production Rules

Never hardcode production endpoints in code.

Prefer:

```text
code default → environment override → platform configuration → secret store
```

But avoid too many override layers without governance.

---

## 4.2 DNS-Based Discovery

DNS-based discovery resolves service names into network endpoints.

Example in Kubernetes:

```text
http://case-service.case-management.svc.cluster.local:8080
```

A shorter form may work inside the same namespace:

```text
http://case-service:8080
```

### Benefits

- simple mental model,
- platform-native in Kubernetes,
- language-independent,
- no application-side registry client needed,
- works well with service load balancing.

### Risks

- DNS caching behavior,
- stale records,
- JVM DNS cache surprises,
- lack of per-instance health awareness in application,
- difficult advanced routing without additional layer,
- discovery and load balancing are often conflated.

### Java DNS Cache Concern

The JVM can cache DNS lookups. This is dangerous if DNS records change and the JVM keeps stale values longer than expected.

Important properties:

```properties
networkaddress.cache.ttl=30
networkaddress.cache.negative.ttl=10
```

These are security properties, not normal application properties. They may be configured through JVM security config or system-level mechanisms depending on runtime.

Design rule:

```text
If your runtime depends on DNS changes, verify JVM DNS caching behavior explicitly.
```

Do not assume that because the platform updates DNS, the Java process will immediately use new addresses.

---

## 4.3 Server-Side Discovery

In server-side discovery, the client calls a stable endpoint such as a load balancer or Kubernetes Service. That layer chooses the backend instance.

```text
Client → Load Balancer / Service VIP → Service Instance
```

### Benefits

- simple client,
- platform handles instance selection,
- language-neutral,
- easier migration,
- central policy possible.

### Risks

- LB becomes critical path,
- health checks may be shallow,
- less client-side awareness,
- overloaded instance may still receive traffic,
- retry behavior may happen in multiple layers.

### Examples

- Kubernetes Service,
- cloud load balancer,
- internal reverse proxy,
- API gateway,
- service mesh sidecar.

---

## 4.4 Client-Side Discovery

In client-side discovery, the application client asks a registry for instances and chooses one.

```text
Client → Service Registry → Instance List
Client → Chosen Instance
```

### Benefits

- client can use richer load-balancing policy,
- client can avoid known-bad instances,
- useful outside Kubernetes or in hybrid environments,
- enables zone-aware or metadata-aware routing.

### Risks

- more client complexity,
- language/framework coupling,
- registry availability becomes important,
- stale cache risk,
- harder governance across many clients.

### Examples

- Netflix Eureka-style discovery,
- Consul service discovery,
- Zookeeper-backed discovery,
- custom registry.

### Rule

Client-side discovery should not be introduced just because it is interesting. It is justified when the client needs routing intelligence unavailable from the platform.

---

## 4.5 Service Mesh Discovery

A service mesh moves discovery, routing, mTLS, retries, circuit breaking, and telemetry into sidecar or ambient infrastructure.

Logical call:

```text
service-a → service-b
```

Runtime call:

```text
service-a → local proxy → mesh control/data plane → service-b proxy → service-b
```

### Benefits

- consistent mTLS,
- centralized traffic policy,
- traffic splitting,
- observability,
- retries/timeouts outside code,
- language-independent.

### Risks

- duplicated retry policies with application code,
- hidden latency,
- sidecar resource overhead,
- complex debugging,
- control plane dependency,
- policy drift,
- false sense of resilience.

### Top-Tier Rule

A service mesh does not remove the need for application-level correctness.

It may route traffic, but it cannot decide business idempotency, semantic retry safety, transaction compensation, or domain authorization.

---

## 5. Service Discovery Decision Matrix

| Context | Preferred Discovery Approach | Why |
|---|---:|---|
| Kubernetes-only internal services | Kubernetes DNS + Service | Simple, native, language-neutral |
| External SaaS API | Configured endpoint + resilient client | Registry not needed |
| Multi-region active-active | DNS/LB + region-aware routing | Topology is above app layer |
| Hybrid VM + container environment | Registry or internal LB | Kubernetes DNS alone insufficient |
| Need zone-aware routing | Client-side or mesh-aware routing | Requires metadata-aware decisions |
| Need traffic split/canary by policy | Mesh or gateway | Central route control useful |
| Highly regulated environment | Stable logical names + audited config | Traceability and change control matter |
| Small system/team | Static endpoint + LB/DNS | Avoid unnecessary platform complexity |

---

## 6. Configuration as Architecture

Configuration is not a bag of key-value pairs. It is part of architecture because it controls runtime behavior.

A service with bad config can violate invariants as easily as bad code.

Example:

```properties
approval.max-pending-days=14
approval.escalation.enabled=true
approval.final-decision.requires-second-review=true
```

Those are not harmless technical values. They encode business policy.

Misconfiguration can cause:

- missed escalation,
- premature rejection,
- wrong SLA computation,
- security bypass,
- data sent to wrong system,
- audit inconsistency.

Therefore configuration needs:

- ownership,
- validation,
- documentation,
- review,
- promotion workflow,
- audit trail,
- rollback plan,
- environment scoping,
- test coverage.

---

## 7. Configuration Categories

## 7.1 Build-Time Configuration

Values fixed when the artifact is built.

Examples:

- artifact version,
- git commit hash,
- build timestamp,
- compiled feature availability,
- dependency versions.

Rule:

```text
Build-time config should not differ by environment except through build metadata.
```

Avoid producing different binaries for dev, UAT, and production unless there is a strong reason.

Good:

```text
same jar/container image promoted across environments
```

Bad:

```text
build dev jar
build uat jar
build prod jar
```

The second approach creates untested artifact drift.

---

## 7.2 Deploy-Time Configuration

Values supplied when deploying.

Examples:

- environment name,
- database endpoint,
- broker endpoint,
- namespace,
- memory limits,
- replica count,
- feature flag defaults.

Deploy-time config often comes from:

- environment variables,
- Kubernetes ConfigMaps,
- Helm/Kustomize values,
- cloud parameter stores,
- platform variables.

---

## 7.3 Runtime Configuration

Values that may change while the service is running.

Examples:

- feature flags,
- log level,
- rate limit,
- circuit breaker threshold,
- emergency kill switch,
- tenant enablement,
- dynamic routing rule.

Runtime configuration is powerful but dangerous.

Questions:

- Is the change atomic?
- Is it eventually applied to all instances?
- What happens if half the pods have old value and half have new value?
- Is the change audited?
- Can it be rolled back?
- Is the value validated before activation?
- Does the service expose current effective config?

---

## 7.4 Secret Configuration

Secrets are sensitive runtime values.

Examples:

- database passwords,
- API tokens,
- OAuth client secrets,
- signing keys,
- mTLS private keys.

Rules:

1. Secrets must not be committed to source control.
2. Secrets must not be printed in logs.
3. Secrets must not be exposed through actuator/debug endpoints.
4. Secrets must be rotated.
5. Secret access must be least privilege.
6. Secret retrieval must be observable without exposing secret values.
7. Secret failure must fail safe.

---

## 8. Configuration Source Hierarchy

A mature service has an explicit hierarchy.

Example:

```text
1. Code defaults
2. Packaged default config
3. Environment-specific config
4. Platform config
5. External config server / parameter store
6. Secret store
7. Emergency override / feature flag system
```

But more layers are not always better. More layers mean harder reasoning.

Top-tier rule:

```text
Every override layer must exist for a reason.
```

If nobody can answer where a value came from, the system is not operable.

---

## 9. Effective Configuration

The most important config is not the file. It is the **effective configuration** used by the running process.

Example problem:

```text
application.yml says timeout = 2s
Kubernetes env var overrides timeout = 5s
Config server overrides timeout = 1s
Feature flag overrides retry enabled = false
Service mesh route has timeout = 800ms
```

What is the real timeout?

A production-ready system should support safe introspection:

```text
GET /internal/effective-config
```

But sensitive values must be masked.

Example output:

```json
{
  "service": "case-service",
  "profile": "prod",
  "configVersion": "2026-06-19T10:15:00Z-abc123",
  "values": {
    "application.client.timeoutMs": {
      "value": 1500,
      "source": "config-server",
      "lastUpdated": "2026-06-19T10:15:00Z"
    },
    "database.password": {
      "value": "***",
      "source": "secret-store",
      "lastUpdated": "2026-06-18T02:00:00Z"
    }
  }
}
```

Do not expose this publicly. Treat it as internal operations endpoint.

---

## 10. Configuration Validation

Configuration should be validated at startup.

Bad service:

```text
Starts successfully.
Fails later when the first request uses missing config.
```

Good service:

```text
Fails fast during startup if required config is missing, invalid, unsafe, or inconsistent.
```

### Java Example: Immutable Config Record

For Java 16+:

```java
public record DownstreamClientConfig(
    URI baseUri,
    Duration connectTimeout,
    Duration readTimeout,
    int maxRetries,
    Duration retryBaseDelay
) {
    public DownstreamClientConfig {
        Objects.requireNonNull(baseUri, "baseUri");
        Objects.requireNonNull(connectTimeout, "connectTimeout");
        Objects.requireNonNull(readTimeout, "readTimeout");
        Objects.requireNonNull(retryBaseDelay, "retryBaseDelay");

        if (!baseUri.isAbsolute()) {
            throw new IllegalArgumentException("baseUri must be absolute");
        }
        if (connectTimeout.isNegative() || connectTimeout.isZero()) {
            throw new IllegalArgumentException("connectTimeout must be positive");
        }
        if (readTimeout.compareTo(connectTimeout) < 0) {
            throw new IllegalArgumentException("readTimeout must be >= connectTimeout");
        }
        if (maxRetries < 0 || maxRetries > 3) {
            throw new IllegalArgumentException("maxRetries must be between 0 and 3");
        }
    }
}
```

For Java 8, use a final class:

```java
public final class DownstreamClientConfig {
    private final URI baseUri;
    private final Duration connectTimeout;
    private final Duration readTimeout;
    private final int maxRetries;
    private final Duration retryBaseDelay;

    public DownstreamClientConfig(
            URI baseUri,
            Duration connectTimeout,
            Duration readTimeout,
            int maxRetries,
            Duration retryBaseDelay) {
        this.baseUri = Objects.requireNonNull(baseUri, "baseUri");
        this.connectTimeout = Objects.requireNonNull(connectTimeout, "connectTimeout");
        this.readTimeout = Objects.requireNonNull(readTimeout, "readTimeout");
        this.maxRetries = maxRetries;
        this.retryBaseDelay = Objects.requireNonNull(retryBaseDelay, "retryBaseDelay");

        validate();
    }

    private void validate() {
        if (!baseUri.isAbsolute()) {
            throw new IllegalArgumentException("baseUri must be absolute");
        }
        if (connectTimeout.isZero() || connectTimeout.isNegative()) {
            throw new IllegalArgumentException("connectTimeout must be positive");
        }
        if (readTimeout.compareTo(connectTimeout) < 0) {
            throw new IllegalArgumentException("readTimeout must be >= connectTimeout");
        }
        if (maxRetries < 0 || maxRetries > 3) {
            throw new IllegalArgumentException("maxRetries must be between 0 and 3");
        }
    }

    public URI baseUri() { return baseUri; }
    public Duration connectTimeout() { return connectTimeout; }
    public Duration readTimeout() { return readTimeout; }
    public int maxRetries() { return maxRetries; }
    public Duration retryBaseDelay() { return retryBaseDelay; }
}
```

---

## 11. Configuration Types by Risk

| Config Type | Example | Risk Level | Change Method |
|---|---:|---:|---|
| Display-only | banner text | Low | Runtime flag acceptable |
| Logging | log level | Medium | Runtime with expiry |
| Timeout | downstream timeout | Medium/High | Controlled rollout |
| Retry count | max retries | High | Controlled rollout + monitoring |
| Security policy | token issuer, audience | Very High | Change review + test |
| Business rule | approval threshold | Very High | Domain owner approval |
| Database endpoint | JDBC URL | Very High | Deployment process |
| Secret | password/token/key | Critical | Secret rotation workflow |
| Feature flag | enable new approval flow | Medium/High | Flag governance |
| Kill switch | disable external integration | Critical | Emergency procedure |

Not all config should be self-service editable by everyone.

---

## 12. Environment Configuration

Typical environments:

```text
local → dev → sit → uat → staging/preprod → prod → dr
```

Common problems:

1. Environment names hardcoded in code.
2. Lower environment uses production-like credentials accidentally.
3. UAT differs too much from production.
4. Production-only behavior is untested.
5. Feature flags differ without documentation.
6. Data retention rules differ silently.
7. External dependencies are mocked in one environment but real in another.
8. Config values copied manually.

### Rule

Environment difference should be explicit and justified.

Good:

```yaml
external-api:
  base-url: ${EXTERNAL_API_BASE_URL}
  timeout-ms: ${EXTERNAL_API_TIMEOUT_MS:1500}
```

Bad:

```java
if (environment.equals("prod")) {
    callRealGateway();
} else {
    callMockGateway();
}
```

Environment branching inside business code is a smell.

---

## 13. Config Drift

Config drift means runtime configuration differs unexpectedly across services, pods, environments, or time.

Examples:

- one pod has old ConfigMap value,
- one service uses old issuer URL,
- production has a manual override nobody recorded,
- UAT has a retry count of 5 while production has 1,
- old deployment references deprecated topic,
- one tenant has wrong feature flag.

### Symptoms

- cannot reproduce production issue,
- only some pods fail,
- behavior differs across requests,
- rollback does not restore behavior,
- incident timeline is confusing,
- support team cannot explain why a rule fired.

### Controls

1. Version configuration.
2. Record config source.
3. Emit config version on startup.
4. Include config version in logs/metrics.
5. Avoid manual console edits without audit.
6. Use GitOps or controlled promotion where appropriate.
7. Compare environment config automatically.
8. Expose masked effective config internally.
9. Restart or reload consistently.

Startup log example:

```text
service=case-service version=2.8.4 env=prod configVersion=2026-06-19.3 secretsVersion=db-2026-06-01 flagsSnapshot=ff-88421
```

---

## 14. Feature Flags

Feature flags allow behavior to be enabled/disabled without redeploying.

They are useful for:

- dark launch,
- canary release,
- tenant-specific rollout,
- emergency disablement,
- experiment,
- operational kill switch.

But feature flags are not free.

### Risks

- branch explosion,
- untested combinations,
- stale flags,
- hidden product behavior,
- inconsistent behavior across pods,
- audit ambiguity,
- security bypass if used carelessly.

### Types of Flags

| Flag Type | Example | Lifetime |
|---|---|---:|
| Release flag | enable new worklist UI | Short |
| Experiment flag | compare search ranking | Short/Medium |
| Ops flag | disable outbound integration | Medium/Long |
| Permission flag | enable module for tenant | Long |
| Migration flag | read from new projection | Temporary |
| Kill switch | stop sending notifications | Long-lived but controlled |

### Rule

Each flag should have:

- owner,
- purpose,
- default,
- expiry date,
- rollback behavior,
- testing matrix,
- audit requirement.

Feature flag metadata example:

```yaml
flags:
  new-case-worklist:
    owner: case-platform-team
    type: release
    default: false
    expires: 2026-09-30
    safe-to-enable-per-tenant: true
    rollback: disable flag; projection remains backward compatible
```

---

## 15. Kill Switches

A kill switch is a runtime control used to stop dangerous behavior quickly.

Examples:

- disable sending email,
- disable external payment call,
- stop publishing event type,
- reject high-cost report generation,
- disable non-critical enrichment,
- pause background worker.

Kill switches should be designed before incidents.

### Good Kill Switch Behavior

- fast to apply,
- audited,
- visible in dashboard,
- safe default,
- clearly scoped,
- reversible,
- tested regularly,
- communicates degraded behavior.

### Example

```java
public final class NotificationPolicy {
    private final RuntimeFlags flags;

    public NotificationDecision shouldSend(NotificationCommand command) {
        if (flags.isEnabled("notification.email.kill-switch")) {
            return NotificationDecision.suppressed("email kill switch enabled");
        }
        return NotificationDecision.allowed();
    }
}
```

A kill switch should not create silent data loss. If messages are suppressed, record that suppression explicitly.

---

## 16. Runtime Reload vs Restart

Some config can be reloaded at runtime. Some should require restart.

| Config | Runtime Reload? | Reason |
|---|---:|---|
| log level | Yes | Low correctness risk |
| feature flag | Yes | Designed for runtime changes |
| kill switch | Yes | Emergency need |
| timeout | Sometimes | Needs careful consistency |
| retry count | Sometimes | Can amplify load |
| DB endpoint | Usually No | Connection pool and transaction risk |
| schema mode | No | Correctness risk |
| auth issuer | Usually No | Security correctness |
| signing key | Carefully | Rotation protocol required |
| thread pool size | Sometimes | Runtime semantics vary |

Runtime reload is not automatically better.

Restart-based config can be safer because:

- startup validation runs,
- all dependencies initialize consistently,
- rollout is observable,
- old and new versions can be controlled.

Runtime reload is better when:

- change must be fast,
- the value is designed for dynamic behavior,
- inconsistent snapshots are acceptable or controlled,
- the system exposes current version.

---

## 17. Spring Configuration Positioning

Spring Boot and Spring Cloud provide rich configuration capabilities.

Common mechanisms:

- `application.yml`,
- profiles,
- environment variables,
- configuration properties,
- config server,
- refresh scope,
- Kubernetes integration,
- actuator endpoints.

### Strong Practice

Use typed configuration properties.

```java
@ConfigurationProperties(prefix = "downstream.application")
public class ApplicationClientProperties {
    /** Base URL of Application Service. */
    private URI baseUrl;

    /** Total request timeout. */
    private Duration timeout = Duration.ofSeconds(2);

    /** Maximum retry attempts for retry-safe operations. */
    private int maxRetries = 1;

    // getters/setters omitted
}
```

Better with validation:

```java
@Validated
@ConfigurationProperties(prefix = "downstream.application")
public class ApplicationClientProperties {
    @NotNull
    private URI baseUrl;

    @NotNull
    @DurationMin(millis = 100)
    @DurationMax(seconds = 10)
    private Duration timeout = Duration.ofSeconds(2);

    @Min(0)
    @Max(3)
    private int maxRetries = 1;
}
```

### Risk

Spring profiles can become uncontrolled branching.

Bad:

```yaml
spring:
  profiles: prod

feature:
  new-flow: true
```

without documenting why production differs from UAT.

### Rule

Use profiles to select environment configuration, not to hide architecture differences.

---

## 18. MicroProfile Config Positioning

MicroProfile Config provides a unified configuration model for enterprise Java runtimes.

Typical injection:

```java
@Inject
@ConfigProperty(name = "downstream.application.base-uri")
URI baseUri;

@Inject
@ConfigProperty(name = "downstream.application.timeout-ms", defaultValue = "1500")
long timeoutMs;
```

This is useful for Jakarta/MicroProfile services because configuration access is standardized across compatible runtimes.

### Rule

Avoid scattering raw `@ConfigProperty` usage deep inside domain logic.

Prefer an application-level config object:

```java
@ApplicationScoped
public class ApplicationClientConfig {
    private final URI baseUri;
    private final Duration timeout;

    @Inject
    public ApplicationClientConfig(
            @ConfigProperty(name = "downstream.application.base-uri") URI baseUri,
            @ConfigProperty(name = "downstream.application.timeout-ms", defaultValue = "1500") long timeoutMs) {
        this.baseUri = Objects.requireNonNull(baseUri);
        this.timeout = Duration.ofMillis(timeoutMs);
        validate();
    }

    private void validate() {
        if (!baseUri.isAbsolute()) {
            throw new IllegalArgumentException("base URI must be absolute");
        }
        if (timeout.isNegative() || timeout.isZero()) {
            throw new IllegalArgumentException("timeout must be positive");
        }
    }

    public URI baseUri() { return baseUri; }
    public Duration timeout() { return timeout; }
}
```

This keeps configuration handling near the application boundary.

---

## 19. Kubernetes Configuration Model

Kubernetes commonly uses:

- ConfigMap for non-confidential config,
- Secret for sensitive config,
- environment variables,
- mounted files,
- service discovery via Service/DNS,
- labels/annotations,
- probes,
- resource requests/limits.

### ConfigMap

A ConfigMap stores non-confidential key-value configuration.

Use for:

- endpoint hostnames,
- feature defaults,
- logging config,
- non-sensitive runtime parameters.

Do not use for secrets.

### Secret

A Kubernetes Secret stores sensitive values such as passwords, tokens, or keys.

Important caveat: using a Kubernetes Secret does not automatically solve all secret-management concerns. You still need RBAC, encryption at rest, access control, rotation, and avoidance of accidental exposure.

### Environment Variables vs Mounted Files

| Method | Benefits | Risks |
|---|---|---|
| Env vars | Simple, common, startup-visible | require restart to change, may leak via process/env inspection |
| Mounted files | can update volume content, good for certs/config files | app must reload safely, file watching complexity |
| External fetch | dynamic, centralized | startup dependency, latency, availability, credential bootstrap |

### Rule

For Java services, prefer startup-bound configuration for high-risk values unless dynamic reload is explicitly designed and tested.

---

## 20. Kubernetes Service Discovery

Kubernetes Service provides a stable logical endpoint for a set of pods.

Simplified model:

```text
Deployment creates Pods
Pods have labels
Service selects Pods by labels
DNS resolves Service name
Traffic is routed to selected endpoints
```

Example Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: application-service
  namespace: case-management
spec:
  selector:
    app: application-service
  ports:
    - name: http
      port: 8080
      targetPort: 8080
```

A client in the same namespace may call:

```text
http://application-service:8080
```

A client in another namespace may call:

```text
http://application-service.case-management.svc.cluster.local:8080
```

### Important Runtime Concern

A Service does not mean all backing pods are equally healthy from the application perspective.

Kubernetes readiness probes determine whether pods are endpoints, but readiness is only as good as the readiness check.

Bad readiness check:

```text
returns 200 if process is alive
```

Better readiness check:

```text
returns ready only if service can accept traffic and critical startup dependencies are initialized
```

But do not make readiness depend on every downstream service, or one dependency outage can remove all pods from load balancing and amplify failure.

---

## 21. Readiness, Liveness, and Startup Probes

### Liveness Probe

Answers:

```text
Should the platform restart this container?
```

Use for unrecoverable process deadlock or broken state.

Do not use liveness as a dependency checker.

Bad:

```text
liveness fails because database is temporarily down
```

This causes restart loops.

### Readiness Probe

Answers:

```text
Should this pod receive traffic?
```

Use for:

- application started,
- HTTP server ready,
- required local resources initialized,
- migration compatibility checked,
- connection pools initialized if necessary.

### Startup Probe

Answers:

```text
Is the application still starting?
```

Useful for slow Java startup, migration-heavy startup, or native image vs JVM differences.

### Rule

Probe design is part of service discovery.

Bad probes create bad topology.

---

## 22. Runtime Topology and Load Balancing

Load balancing is not only distributing requests. It is a correctness and resilience mechanism.

Important questions:

- Is load balancing per request or per connection?
- Does HTTP keep-alive pin traffic?
- Does gRPC multiplex many calls over one connection?
- Are long-lived connections redistributed after scaling?
- Does the client pool refresh endpoints?
- Does the load balancer observe latency or only availability?
- Is routing zone-aware?
- Is traffic split during canary?

### Connection Reuse Risk

A Java client may maintain persistent connections. If a service scales from 2 to 10 pods, existing clients may keep using old connections and not distribute traffic evenly.

This is common with:

- HTTP keep-alive,
- HTTP/2,
- gRPC,
- database pools,
- message broker connections.

### Rule

Autoscaling service replicas does not guarantee instant load redistribution.

Test scale-out behavior under real client connection patterns.

---

## 23. Configuration and Connection Pools

Configuration often controls resource pools:

```properties
server.tomcat.threads.max=200
spring.datasource.hikari.maximum-pool-size=30
http.client.max-connections=100
consumer.worker.count=16
```

These values are coupled.

Bad configuration:

```text
100 pods × 30 DB connections = 3000 database connections
```

If DB supports 600 connections, deployment fails under scale.

### Capacity Equation

```text
total_connections = replicas × pool_size_per_replica
```

For multiple services:

```text
DB_total = Σ(service_replicas × service_pool_size)
```

### Rule

Pool configuration must be reviewed at platform level, not only service level.

Microservices multiply resource consumption.

---

## 24. Configuration and Timeout Budget

Timeouts are configuration, but they encode architecture.

Example call chain:

```text
Frontend → BFF → Case Service → Application Service → Profile Service
```

If frontend timeout is 5s, inner services cannot each use 5s.

Bad:

```text
BFF timeout = 5s
Case → Application timeout = 5s
Application → Profile timeout = 5s
```

Good:

```text
Frontend total budget = 5s
BFF internal budget = 4.5s
Case budget = 3s
Application budget = 1.5s
Profile budget = 700ms
```

Config should express deadline thinking, not random values.

```yaml
request-budget:
  external-ms: 5000
  bff-to-case-ms: 3000
  case-to-application-ms: 1500
  application-to-profile-ms: 700
```

But avoid hardcoding call-chain knowledge everywhere. For advanced systems, propagate request deadlines.

---

## 25. Configuration and Retry Budget

Retry is dangerous when configured casually.

If every service retries three times in a chain of five services, load amplification can explode.

Simplified amplification:

```text
attempts = 3^5 = 243
```

Even if actual behavior is less extreme, the direction is dangerous.

### Rule

Retry config must specify:

- which operations are retry-safe,
- max attempts,
- backoff,
- jitter,
- total deadline,
- retry budget,
- retryable errors,
- non-retryable errors.

Example:

```yaml
clients:
  profile-service:
    timeout-ms: 800
    retry:
      enabled: true
      max-attempts: 2
      base-delay-ms: 50
      max-delay-ms: 200
      jitter: true
      retry-on:
        - CONNECT_TIMEOUT
        - HTTP_503
      never-retry-on:
        - HTTP_400
        - HTTP_401
        - HTTP_403
        - BUSINESS_VALIDATION_FAILED
```

---

## 26. Service Discovery and Security

Discovery is not authorization.

Just because service A can discover service B does not mean A should be allowed to call B.

Security controls may include:

- network policies,
- mTLS,
- service identity,
- OAuth2 client credentials,
- token exchange,
- audience validation,
- authorization policy,
- API gateway policy,
- service mesh authorization.

### Anti-Pattern

```text
Any service in the namespace can call any other service.
```

This is easy but weak.

### Better

```text
case-service can call application-service approval API.
report-service can call read-model API only.
notification-service cannot call decision mutation API.
```

Topology should reflect least privilege.

---

## 27. Cross-Environment and Cross-Region Topology

Many incidents happen because services accidentally call the wrong environment.

Examples:

- dev calls production API,
- UAT sends email to real users,
- staging writes to production bucket,
- DR environment reads primary region secret,
- batch job runs in both active and standby regions.

### Controls

1. Environment-specific identity.
2. Environment-specific credentials.
3. Network segmentation.
4. Endpoint allowlist.
5. Runtime guardrails.
6. Clear naming.
7. Logs include environment and region.
8. Fail startup if environment mismatch is detected.

Example startup guard:

```java
public final class EnvironmentGuard {
    public static void verify(EnvironmentConfig env, URI downstreamUri) {
        if (env.name().equals("prod") && downstreamUri.getHost().contains("uat")) {
            throw new IllegalStateException("Production service cannot call UAT endpoint: " + downstreamUri.getHost());
        }
        if (env.name().equals("uat") && downstreamUri.getHost().contains("prod")) {
            throw new IllegalStateException("UAT service cannot call production endpoint: " + downstreamUri.getHost());
        }
    }
}
```

This is not a replacement for network controls, but it catches misconfiguration early.

---

## 28. Multi-Tenant Configuration

Multi-tenant systems often need tenant-specific configuration.

Examples:

- tenant-specific feature enablement,
- tenant-specific SLA,
- tenant-specific data retention,
- tenant-specific integration endpoint,
- tenant-specific rate limit,
- tenant-specific branding,
- tenant-specific authorization policy.

### Risk

Tenant config can become a hidden database of business rules.

### Rules

1. Tenant config must have schema.
2. Tenant config must have owner.
3. Tenant config changes must be audited.
4. Tenant config must be validated before activation.
5. Tenant config must be visible to support teams safely.
6. Tenant config must not leak secrets.
7. Tenant config must be included in incident timeline.

Example:

```yaml
tenants:
  agency-a:
    features:
      advanced-screening: true
    rate-limit:
      requests-per-minute: 300
    retention:
      case-years: 7
  agency-b:
    features:
      advanced-screening: false
    rate-limit:
      requests-per-minute: 100
    retention:
      case-years: 5
```

For serious systems, store this in governed configuration service or policy store, not random YAML fragments.

---

## 29. Configuration Ownership Model

Every config value should have an owner.

| Config | Owner |
|---|---|
| JVM heap size | Platform/Service owner |
| DB pool size | Service owner + DBA/platform |
| API timeout | Service owner |
| Business threshold | Product/domain owner |
| SLA duration | Business/regulatory owner |
| OAuth issuer | Security/platform owner |
| Feature flag | Product + service owner |
| Kill switch | Operations + service owner |
| Secret | Security/platform + service owner |

Ownership matters because config changes can be production changes.

---

## 30. Configuration Change Process

A robust config change process asks:

1. What value changes?
2. Why does it change?
3. Who owns it?
4. Which environments are affected?
5. Is it backward compatible?
6. Does it require restart?
7. Does it affect security?
8. Does it affect data correctness?
9. Does it affect SLA?
10. How is it validated?
11. How is it rolled back?
12. How is it audited?
13. What dashboard should be watched after change?

Config change is deployment-adjacent. Treat it seriously.

---

## 31. Runtime Topology Observability

You cannot operate what you cannot see.

Expose and record:

- service name,
- instance id,
- pod name,
- node,
- zone,
- region,
- version,
- config version,
- feature flag snapshot,
- dependency endpoints,
- connection pool metrics,
- DNS resolution failures,
- downstream call metrics,
- retry counts,
- circuit breaker state,
- queue depth,
- consumer lag,
- readiness state.

### Startup Event

On startup, emit a structured event:

```json
{
  "event": "SERVICE_STARTED",
  "service": "case-service",
  "version": "2.8.4",
  "javaVersion": "21.0.7",
  "runtime": "kubernetes",
  "namespace": "prod-case",
  "pod": "case-service-788fdcd9f7-abc12",
  "node": "ip-10-0-1-42",
  "region": "ap-southeast-1",
  "configVersion": "cfg-20260619-03",
  "featureFlagSnapshot": "ff-88421"
}
```

This helps incident reconstruction.

---

## 32. Topology-Aware Failure Modes

## 32.1 DNS Cache Stale

Symptom:

```text
Some Java processes keep calling old IP after service migration.
```

Controls:

- verify JVM DNS TTL,
- use stable service names,
- avoid relying on fast DNS change where not guaranteed,
- restart clients during critical endpoint migration if needed,
- monitor connection failures by target IP/host.

## 32.2 ConfigMap Changed But Pods Not Restarted

Symptom:

```text
New config exists in Kubernetes, but pods still use old env var values.
```

Controls:

- understand env var vs mounted file behavior,
- restart rollout on config change,
- config checksum annotation,
- expose effective config version,
- avoid manual assumptions.

## 32.3 Secret Rotated But Connection Pool Still Uses Old Credential

Symptom:

```text
New DB password stored, but service keeps failing after old password revoked.
```

Controls:

- coordinated rotation process,
- overlap old/new credentials,
- connection pool refresh,
- rolling restart,
- secret version metrics.

## 32.4 Service Scaled But Load Not Rebalanced

Symptom:

```text
New pods exist but old pods remain hot.
```

Controls:

- understand connection reuse,
- tune client pools,
- connection max lifetime,
- HTTP/2/gRPC balancing strategy,
- load test scale-out behavior.

## 32.5 Readiness Probe Too Shallow

Symptom:

```text
Traffic sent to pod before it can process real requests.
```

Controls:

- readiness reflects actual ability to accept traffic,
- startup probe for slow boot,
- warm caches carefully,
- initialize required local resources.

## 32.6 Readiness Probe Too Deep

Symptom:

```text
All pods marked unready because a downstream service is down.
```

Controls:

- do not make readiness depend on every downstream,
- use degraded mode,
- expose dependency health separately,
- design readiness around accepting traffic, not full dependency graph perfection.

## 32.7 Config Drift Across Pods

Symptom:

```text
Requests produce different behavior depending on pod.
```

Controls:

- config version in logs,
- rollout status enforcement,
- avoid partial dynamic reload for critical values,
- compare effective config.

---

## 33. Java 8–25 Considerations

## 33.1 Java 8

Java 8 is common in legacy enterprise services.

Concerns:

- older HTTP client ecosystem,
- more reliance on Apache HttpClient/OkHttp/RestTemplate,
- no records,
- no virtual threads,
- older container ergonomics depending on update level,
- more risk around old framework versions.

Recommendations:

- use immutable config classes,
- validate config at startup,
- explicitly manage HTTP client timeouts,
- verify DNS cache properties,
- avoid static global config access,
- use mature external config library/framework.

## 33.2 Java 11

Java 11 introduced standard `java.net.http.HttpClient`.

Useful for:

- simple internal HTTP clients,
- explicit timeout management,
- modern TLS behavior,
- reducing third-party dependency when needs are simple.

Still consider framework clients where you need:

- metrics,
- tracing,
- retry integration,
- load balancing,
- auth filters,
- contract integration.

## 33.3 Java 17

Java 17 is a strong modern enterprise baseline.

Useful language/runtime features:

- records for config DTOs,
- sealed classes for controlled config variants,
- better JVM container behavior,
- mature Spring Boot 3/Jakarta EE 10 ecosystem alignment.

## 33.4 Java 21

Java 21 introduces virtual threads as a stable feature.

Impact:

- blocking service clients become more scalable,
- thread-per-request model becomes viable again for many workloads,
- connection pools and downstream capacity remain limiting factors,
- virtual threads do not remove need for timeout/backpressure.

Configuration implication:

```text
Do not increase concurrency just because virtual threads make it cheap.
```

The bottleneck may move to database, broker, downstream API, CPU, or rate limit.

## 33.5 Java 25

Java 25 is the current latest LTS-era horizon in this series.

For this topic, Java 25 does not magically change service discovery or config architecture. Its relevance is mostly:

- modern runtime baseline,
- continued virtual thread ecosystem maturity,
- improved JVM behavior over older baselines,
- opportunity to remove legacy config hacks.

Principle:

```text
Newer Java improves runtime ergonomics, but topology correctness is still architectural.
```

---

## 34. Example: Production-Grade Config Object

```java
public final class ServiceRuntimeConfig {
    private final String serviceName;
    private final String environment;
    private final String region;
    private final String configVersion;

    public ServiceRuntimeConfig(
            String serviceName,
            String environment,
            String region,
            String configVersion) {
        this.serviceName = requireText(serviceName, "serviceName");
        this.environment = requireAllowed(environment, "environment", Set.of("local", "dev", "sit", "uat", "staging", "prod", "dr"));
        this.region = requireText(region, "region");
        this.configVersion = requireText(configVersion, "configVersion");
    }

    private static String requireText(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return value.trim();
    }

    private static String requireAllowed(String value, String name, Set<String> allowed) {
        String normalized = requireText(value, name).toLowerCase(Locale.ROOT);
        if (!allowed.contains(normalized)) {
            throw new IllegalArgumentException(name + " must be one of " + allowed + ", got " + value);
        }
        return normalized;
    }

    public boolean isProduction() {
        return "prod".equals(environment);
    }

    public String serviceName() { return serviceName; }
    public String environment() { return environment; }
    public String region() { return region; }
    public String configVersion() { return configVersion; }
}
```

This class is intentionally boring. Boring configuration code is good. It should be explicit, validated, and easy to inspect.

---

## 35. Example: Dependency Endpoint Config

```java
public final class DependencyEndpointConfig {
    private final String dependencyName;
    private final URI baseUri;
    private final Duration totalTimeout;
    private final int maxConnections;
    private final RetryPolicy retryPolicy;

    public DependencyEndpointConfig(
            String dependencyName,
            URI baseUri,
            Duration totalTimeout,
            int maxConnections,
            RetryPolicy retryPolicy) {
        this.dependencyName = requireText(dependencyName, "dependencyName");
        this.baseUri = Objects.requireNonNull(baseUri, "baseUri");
        this.totalTimeout = Objects.requireNonNull(totalTimeout, "totalTimeout");
        this.maxConnections = maxConnections;
        this.retryPolicy = Objects.requireNonNull(retryPolicy, "retryPolicy");
        validate();
    }

    private void validate() {
        if (!baseUri.isAbsolute()) {
            throw new IllegalArgumentException("baseUri must be absolute for " + dependencyName);
        }
        if (!Set.of("http", "https").contains(baseUri.getScheme())) {
            throw new IllegalArgumentException("baseUri scheme must be http or https for " + dependencyName);
        }
        if (totalTimeout.isZero() || totalTimeout.isNegative()) {
            throw new IllegalArgumentException("totalTimeout must be positive for " + dependencyName);
        }
        if (totalTimeout.compareTo(Duration.ofSeconds(30)) > 0) {
            throw new IllegalArgumentException("totalTimeout too high for " + dependencyName);
        }
        if (maxConnections < 1 || maxConnections > 1000) {
            throw new IllegalArgumentException("maxConnections out of range for " + dependencyName);
        }
    }

    private static String requireText(String value, String name) {
        if (value == null || value.trim().isEmpty()) {
            throw new IllegalArgumentException(name + " is required");
        }
        return value.trim();
    }
}
```

The config object acts as a guardrail. It prevents bad runtime behavior from entering the system silently.

---

## 36. Example: Retry Policy Config

```java
public final class RetryPolicy {
    private final boolean enabled;
    private final int maxAttempts;
    private final Duration baseDelay;
    private final Duration maxDelay;
    private final boolean jitter;

    public RetryPolicy(boolean enabled, int maxAttempts, Duration baseDelay, Duration maxDelay, boolean jitter) {
        this.enabled = enabled;
        this.maxAttempts = maxAttempts;
        this.baseDelay = Objects.requireNonNull(baseDelay, "baseDelay");
        this.maxDelay = Objects.requireNonNull(maxDelay, "maxDelay");
        this.jitter = jitter;
        validate();
    }

    private void validate() {
        if (!enabled && maxAttempts != 1) {
            throw new IllegalArgumentException("disabled retry should use maxAttempts=1");
        }
        if (enabled && (maxAttempts < 2 || maxAttempts > 3)) {
            throw new IllegalArgumentException("retry maxAttempts should usually be 2..3");
        }
        if (baseDelay.isNegative() || baseDelay.isZero()) {
            throw new IllegalArgumentException("baseDelay must be positive");
        }
        if (maxDelay.compareTo(baseDelay) < 0) {
            throw new IllegalArgumentException("maxDelay must be >= baseDelay");
        }
    }

    public boolean enabled() { return enabled; }
    public int maxAttempts() { return maxAttempts; }
    public Duration baseDelay() { return baseDelay; }
    public Duration maxDelay() { return maxDelay; }
    public boolean jitter() { return jitter; }
}
```

The point is not the class itself. The point is that resilience behavior should be explicit and validated.

---

## 37. Example: Kubernetes Deployment with Config Checksum

One common pattern is to include a checksum annotation so config changes trigger rollout.

Conceptual example:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: case-service
spec:
  template:
    metadata:
      annotations:
        config.checksum/application: "sha256-of-configmap-content"
        secret.version/database: "db-credential-2026-06-01"
    spec:
      containers:
        - name: case-service
          image: registry.example.com/case-service:2.8.4
          env:
            - name: SERVICE_NAME
              value: "case-service"
            - name: ENVIRONMENT
              valueFrom:
                configMapKeyRef:
                  name: case-service-config
                  key: environment
            - name: DATABASE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: case-service-db-secret
                  key: password
```

This avoids the common problem where ConfigMap changes do not automatically restart pods that consume values as environment variables.

---

## 38. Anti-Patterns

## 38.1 Hardcoded Endpoint

```java
private static final String PROFILE_URL = "https://prod-profile.internal/api";
```

Danger:

- impossible safe environment promotion,
- accidental production calls,
- poor testability,
- hidden dependency.

## 38.2 Environment Branching in Business Logic

```java
if (env.equals("prod")) {
    enforceRuleA();
} else {
    skipRuleA();
}
```

Danger:

- production-only behavior,
- untested paths,
- audit risk.

## 38.3 Config Without Owner

A value exists, nobody knows why.

Danger:

- nobody dares change it,
- behavior becomes folklore,
- incident recovery slows down.

## 38.4 Secret as Plain Config

```yaml
db.password: super-secret
```

Danger:

- source control exposure,
- log exposure,
- broad access,
- no rotation.

## 38.5 Dynamic Reload for Critical Config Without Protocol

Danger:

- half-applied changes,
- inconsistent behavior,
- impossible incident reconstruction.

## 38.6 Service Discovery Without Timeout

```text
Service can be found, but call can hang.
```

Discovery solves location. It does not solve waiting.

## 38.7 Global Common Config Dump

```yaml
common:
  everything-for-all-services
```

Danger:

- tight coupling,
- accidental dependency,
- change blast radius,
- unclear ownership.

## 38.8 Feature Flag Graveyard

Flags remain forever.

Danger:

- combinatorial testing explosion,
- hidden behavior,
- dead code,
- unexpected production path.

---

## 39. Production Readiness Checklist

### Service Discovery

- [ ] Does each dependency have a logical name?
- [ ] Is discovery method explicit?
- [ ] Is DNS caching behavior understood?
- [ ] Are timeouts configured for each dependency?
- [ ] Are retries safe and bounded?
- [ ] Is load balancing behavior understood?
- [ ] Is service mesh/application retry duplication avoided?
- [ ] Are readiness checks meaningful?
- [ ] Are liveness checks not dependency-based?
- [ ] Is scale-out behavior tested?

### Configuration

- [ ] Are required config values validated at startup?
- [ ] Are high-risk config values owned?
- [ ] Is effective config inspectable safely?
- [ ] Is config version emitted in logs/metrics?
- [ ] Is config drift detectable?
- [ ] Are environment differences documented?
- [ ] Are manual changes audited?
- [ ] Are config changes promoted safely?
- [ ] Are risky changes tested before production?
- [ ] Is rollback defined?

### Secrets

- [ ] Are secrets separate from non-secret config?
- [ ] Are secrets never logged?
- [ ] Are secrets access-controlled?
- [ ] Are secrets rotated?
- [ ] Is rotation tested?
- [ ] Is old/new credential overlap handled?
- [ ] Are secret versions observable without revealing value?

### Runtime Topology

- [ ] Are service, pod, node, zone, region visible in telemetry?
- [ ] Are dependency endpoints observable?
- [ ] Are connection pool sizes aligned with replicas?
- [ ] Are cross-environment calls prevented?
- [ ] Are tenant-specific routes/config audited?
- [ ] Are topology changes included in incident review?

---

## 40. Architecture Review Questions

1. How does this service discover each dependency?
2. What happens if the dependency IP changes while the JVM is running?
3. Who owns each endpoint configuration?
4. Can this service accidentally call another environment?
5. Are dependency timeouts consistent with the end-to-end request budget?
6. Are retry values safe under cascading failure?
7. Which configuration values can change at runtime?
8. Which configuration values require restart?
9. How is config drift detected?
10. How do we know which config version handled a request?
11. How are secrets rotated?
12. What happens if secret rotation occurs while connections are open?
13. What happens if only half the pods receive the new config?
14. Are feature flags owned and expired?
15. Are kill switches tested?
16. Does readiness reflect ability to serve traffic?
17. Does liveness avoid restart storms?
18. Does scaling replicas overload downstream pools?
19. Does service mesh policy duplicate application policy?
20. Can support/operations inspect current effective config safely?

---

## 41. Case Study: Regulatory Case Management Runtime Topology

Suppose we have services:

```text
case-service
application-service
profile-service
notification-service
audit-service
screening-service
report-service
```

### Bad Runtime Design

```text
case-service has hardcoded URLs to all services.
all services share common config file.
all services use same DB credential.
feature flags are manually edited in production.
readiness checks only return process up.
service mesh retries 3 times; application also retries 3 times.
DB pool size is 30 for every service regardless of replicas.
config changes are not versioned.
```

Failure scenario:

1. Profile service becomes slow.
2. Case service retries.
3. Mesh retries too.
4. Thread pools fill.
5. DB connections remain occupied.
6. Readiness still reports healthy.
7. Traffic continues.
8. Config change tries to reduce retry count.
9. Half pods still use old config.
10. Incident team cannot tell which pod used which retry policy.

### Better Runtime Design

```text
Each service uses logical dependency names.
Kubernetes DNS or mesh handles internal discovery.
Each dependency has explicit timeout/retry policy.
Retries are coordinated between app and mesh.
Config has version and owner.
Secrets are separated and rotated through procedure.
Readiness indicates ability to accept traffic.
Dependency health is exposed separately.
Pool sizes are reviewed against replica counts.
Feature flags have owner, expiry, audit.
Kill switches exist for external integrations.
Startup emits config/runtime topology event.
```

In this design, runtime behavior is explainable during incident.

---

## 42. Design Exercise

Take one service from your architecture and fill this table.

| Question | Answer |
|---|---|
| Service name |  |
| Runtime platform |  |
| Java version |  |
| Discovery method |  |
| Dependencies |  |
| Config sources |  |
| Secret sources |  |
| Config version visible? |  |
| Feature flags |  |
| Kill switches |  |
| Runtime reload values |  |
| Restart-required values |  |
| Readiness rule |  |
| Liveness rule |  |
| Pool sizes |  |
| Replica count |  |
| Downstream timeout budget |  |
| Retry policy |  |
| Cross-environment guard |  |
| Drift detection |  |
| Owner |  |

Then answer:

1. Which config value can cause the biggest production incident?
2. Which dependency has the weakest discovery/failure behavior?
3. Which config value has no clear owner?
4. Which config value differs most across environments?
5. Which runtime assumption has never been tested?

---

## 43. Key Takeaways

1. Service discovery solves location, not correctness.
2. Configuration is architecture, not just key-value storage.
3. Secrets need different lifecycle, access control, and rotation from normal config.
4. Runtime topology changes continuously; static assumptions are dangerous.
5. Kubernetes DNS is useful, but Java DNS caching and connection reuse still matter.
6. Readiness/liveness probes are part of service discovery quality.
7. Feature flags and kill switches are powerful but need ownership and expiry.
8. Effective config matters more than config files.
9. Config drift can make incidents impossible to explain.
10. Pool sizes, retries, timeouts, and replica counts must be reviewed together.
11. Runtime reload is not always safer than restart.
12. Java 8–25 changes implementation options, but not the need for explicit topology design.

---

## 44. References

- Spring Cloud official project page: https://spring.io/projects/spring-cloud
- Spring Cloud Config Server reference: https://docs.spring.io/spring-cloud-config/reference/server.html
- MicroProfile Config 3.1 specification: https://download.eclipse.org/microprofile/microprofile-config-3.1/microprofile-config-spec-3.1.html
- MicroProfile 7.1 compatible specifications: https://microprofile.io/compatible/7-1/
- Kubernetes ConfigMap documentation: https://kubernetes.io/docs/concepts/configuration/configmap/
- Kubernetes Secret documentation: https://kubernetes.io/docs/concepts/configuration/secret/
- Kubernetes Pods documentation: https://kubernetes.io/docs/concepts/workloads/pods/
- Kubernetes Services, networking, and DNS documentation: https://kubernetes.io/docs/concepts/services-networking/
- The Twelve-Factor App, Config: https://12factor.net/config
- Google SRE Book, Addressing Cascading Failures: https://sre.google/sre-book/addressing-cascading-failures/
- AWS Builders Library, Timeouts, retries, and backoff with jitter: https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/

---

## 45. Status Seri

Kita telah menyelesaikan:

```text
Part 14 — Service Discovery, Configuration, and Runtime Topology
```

Seri belum selesai.

Progress:

```text
14 selesai dari total 35 part
```

Part berikutnya:

```text
Part 15 — Resilience Pattern: Timeout, Retry, Circuit Breaker, Bulkhead
```

Filename berikutnya:

```text
learn-java-microservices-patterns-advanced-engineering-15-resilience-timeout-retry-circuit-breaker-bulkhead.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-microservices-patterns-advanced-engineering-13-api-gateway-edge-bff-experience-layer.md">⬅️ Learn Java Microservices Patterns Advanced Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-microservices-patterns-advanced-engineering-15-resilience-timeout-retry-circuit-breaker-bulkhead.md">Learn Java Microservices Patterns — Advanced Engineering ➡️</a>
</div>
