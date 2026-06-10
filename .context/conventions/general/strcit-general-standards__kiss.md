# Strict General Standards: KISS

> File: `strcit-general-standards__kiss.md`  
> Category: General Engineering Standard  
> Principle: KISS — Keep It Simple  
> Status: Mandatory for LLM-assisted code generation, implementation, refactoring, and review

---

## 1. Purpose

This standard defines how an LLM code agent MUST apply the KISS principle when designing, implementing, modifying, or reviewing software.

KISS means the solution should be as simple as possible while still satisfying the real requirement, preserving correctness, and remaining maintainable under expected change.

KISS does not mean careless, naive, under-engineered, or ignoring failure cases. It means unnecessary complexity is treated as a defect.

---

## 2. Canonical Interpretation

For this standard:

> Prefer the simplest design that correctly satisfies the current known requirement and keeps future change understandable.

A simple solution is one that is easy to:

- read;
- reason about;
- test;
- debug;
- operate;
- secure;
- modify;
- delete;
- explain to another engineer.

Simplicity is measured from the perspective of the system maintainer, not from the perspective of the person writing code for the first time.

---

## 3. Simple Does Not Mean Simplistic

The LLM MUST distinguish between real simplicity and fake simplicity.

| Type                  | Meaning                                               | Example                                             |
| --------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| Real simplicity       | Fewer concepts, clear ownership, explicit flow        | direct service method with clear policy object      |
| Fake simplicity       | Hides complexity somewhere else                       | global helper that mutates hidden state             |
| Under-engineering     | Ignores known correctness or failure requirements     | no transaction around multi-step state change       |
| Over-engineering      | Solves imagined future requirements                   | plugin framework for one implementation             |
| Accidental complexity | Complexity caused by tools/design choices, not domain | event sourcing for simple CRUD without audit need   |
| Essential complexity  | Complexity inherent in the domain                     | legal workflow with appeals, deadlines, audit trail |

KISS removes accidental complexity. It does not erase essential domain complexity.

---

## 4. Mandatory Rules

### KISS-001: Start with the direct solution

The LLM MUST begin with the most direct correct implementation before introducing abstractions, frameworks, patterns, asynchronous workflows, generic components, or distributed mechanisms.

Bad starting point:

```text
Create Strategy + Factory + Registry + PluginLoader + AbstractBaseProcessor.
```

Good starting point:

```text
Implement the required behavior directly behind a named domain method.
Extract variation only when real variation exists.
```

---

### KISS-002: Complexity MUST be justified

The LLM MUST NOT introduce complexity without a clear reason.

Complexity includes:

- new framework;
- new library;
- inheritance hierarchy;
- generic abstraction;
- reflection;
- dynamic dispatch registry;
- code generation;
- background worker;
- queue/event broker;
- cache;
- distributed lock;
- scheduler;
- separate service;
- custom DSL;
- plugin system;
- metadata-driven engine;
- complex configuration;
- concurrency;
- asynchronous workflow;
- retry mechanism;
- circuit breaker;
- custom serialization;
- global mutable state;
- hidden magic.

Before adding any of these, the LLM MUST be able to state:

```text
This complexity is required because: <specific requirement or constraint>.
Without it, the system fails by: <specific failure mode>.
The simpler alternative was rejected because: <reason>.
```

---

### KISS-003: Do not build for imaginary future requirements

The LLM MUST NOT add features, extension points, generic frameworks, or configuration switches for requirements that are not currently needed or strongly implied.

Forbidden phrases as justification:

- "just in case";
- "for future flexibility";
- "maybe later";
- "this might be useful";
- "enterprise-ready";
- "to make it generic";
- "because this pattern is common".

Future change should be enabled by clear boundaries, tests, and low coupling, not speculative machinery.

---

### KISS-004: Prefer explicit control flow

The LLM SHOULD prefer straightforward control flow over clever indirection.

Preferred:

- simple method calls;
- clear conditionals;
- explicit command handling;
- named policy methods;
- readable loops;
- data structures with obvious ownership.

Avoid unless justified:

- deep callback chains;
- reflection-based dispatch;
- annotation magic;
- global registries;
- runtime classpath scanning;
- hidden proxies;
- implicit lifecycle hooks;
- excessive AOP;
- metaprogramming;
- dynamic evaluation.

---

### KISS-005: Prefer boring, standard technology

The LLM MUST prefer existing platform capabilities and proven project conventions before adding new technology.

Decision order:

1. existing project convention;
2. language standard library;
3. existing project dependency;
4. small well-known dependency;
5. new framework only with explicit justification;
6. custom framework only as last resort.

The LLM MUST NOT add a dependency for trivial functionality.

---

### KISS-006: Keep abstractions narrow and named by intent

Abstractions MUST represent a real domain or technical concept.

Bad:

```java
GenericProcessor<T>
BaseManager
CommonHelper
AbstractExecutor
UniversalHandler
```

Good:

```java
AppealDeadlinePolicy
CaseEscalationWorkflow
PaymentRetryPolicy
DocumentRetentionCalculator
```

An abstraction is acceptable only when it reduces cognitive load and has a clear reason to change.

---

### KISS-007: Avoid inheritance for reuse by default

The LLM MUST NOT use inheritance merely to share code.

Prefer:

- composition;
- small collaborator objects;
- pure functions;
- explicit policies;
- interfaces for real substitution;
- delegation.

Inheritance is allowed when:

- there is a true subtype relationship;
- the base contract is stable;
- overridden behavior is limited and predictable;
- tests cover substitution behavior.

---

### KISS-008: Keep functions and classes cohesive, not mechanically tiny

The LLM MUST NOT split code into many tiny fragments just to appear clean.

A function is too complex when it mixes different abstraction levels, has many reasons to change, or cannot be tested/read easily.

A function is too fragmented when understanding one behavior requires jumping across many trivial wrappers.

KISS prefers cohesive clarity over arbitrary size rules.

---

### KISS-009: Avoid unnecessary concurrency and asynchrony

The LLM MUST NOT introduce threads, async pipelines, queues, actors, schedulers, or reactive flows unless the requirement needs them.

Valid reasons include:

- latency isolation;
- throughput;
- external system slowness;
- retryable integration;
- long-running process;
- backpressure;
- independent failure boundary;
- user request must not block;
- event-driven domain requirement.

If a synchronous transaction is simpler and correct, prefer it.

---

### KISS-010: Avoid unnecessary caching

The LLM MUST NOT add caching unless there is a measured or strongly expected performance problem.

Caching adds complexity:

- invalidation;
- stale data;
- memory pressure;
- distributed consistency;
- cache stampede;
- observability;
- warm-up behavior;
- failure fallback.

A cache MUST define:

- key;
- value;
- TTL or invalidation trigger;
- consistency guarantee;
- fallback behavior;
- metrics;
- test strategy.

---

### KISS-011: Prefer declarative data over executable logic when sufficient

When representing configuration, schema, routing tables, validation rules, or static policy, the LLM SHOULD prefer the least powerful representation that can express the need.

Preferred when sufficient:

- constants;
- enum;
- table;
- JSON/YAML/TOML;
- database lookup table;
- schema;
- declarative mapping;
- simple rule table.

Avoid executable scripts, reflection, dynamic plugins, or custom DSLs unless clearly required.

---

### KISS-012: Keep error handling explicit and local

The LLM MUST avoid global magical error handling that hides behavior.

Good error handling:

- identifies failure type;
- preserves cause;
- maps to stable external response;
- logs at the correct boundary;
- avoids duplicate logging;
- defines retryability;
- is testable.

Bad error handling:

- catches `Exception` and ignores it;
- wraps everything into generic runtime exception;
- logs and rethrows everywhere;
- hides errors behind nulls;
- silently retries without budget;
- returns ambiguous boolean result.

---

### KISS-013: Keep configuration minimal

The LLM MUST NOT expose configuration switches unless operators or deployers actually need them.

Each config option MUST have:

- clear name;
- default value;
- valid range;
- unit;
- operational effect;
- failure behavior;
- owner.

Too much configuration is complexity transferred from developer to operator.

---

### KISS-014: Prefer readable duplication over harmful abstraction

The LLM MUST NOT violate KISS to satisfy DRY superficially.

Small local duplication is acceptable when abstraction would:

- couple unrelated concepts;
- hide domain intent;
- introduce generic plumbing;
- make call sites harder to read;
- require flags or hooks for special cases;
- create a shared dependency across bounded contexts.

---

### KISS-015: Design for deletion

A simple solution should be easy to remove.

The LLM SHOULD avoid designs that make deletion difficult:

- global registries;
- circular dependencies;
- broad inheritance trees;
- framework callbacks everywhere;
- shared mutable singletons;
- cross-cutting static helpers;
- implicit side effects;
- hidden runtime scanning.

---

## 5. KISS Decision Algorithm for LLMs

Before implementing, the LLM MUST follow this sequence:

1. Restate the real requirement in one or two sentences.
2. Identify the minimum behavior required now.
3. Identify correctness, security, audit, performance, and operational constraints.
4. Propose the simplest direct design.
5. List any complexity being introduced.
6. Justify each complexity item with a concrete requirement or failure mode.
7. Remove any complexity that lacks justification.
8. Prefer existing project patterns over new mechanisms.
9. Add tests for behavior and failure cases.
10. Re-check whether a new engineer can understand the solution quickly.

If step 6 fails, the LLM MUST simplify the design.

---

## 6. Complexity Budget

The LLM MUST treat each added concept as a cost.

| Complexity item       | Cost introduced                                   |
| --------------------- | ------------------------------------------------- |
| New abstraction       | more concepts to understand                       |
| New dependency        | versioning, security, maintenance                 |
| New framework         | lifecycle, conventions, hidden behavior           |
| Async process         | ordering, retries, observability, idempotency     |
| Cache                 | invalidation and stale data                       |
| Generic engine        | debugging difficulty and weaker static guarantees |
| Reflection            | hidden coupling and runtime failure               |
| Configuration         | operational burden                                |
| Distributed component | deployment, network, partial failure              |
| Inheritance hierarchy | fragile coupling across subclasses                |
| Global state          | test pollution and hidden side effects            |

The LLM MUST minimize total system complexity, not merely reduce lines of code.

---

## 7. Acceptable Complexity

Complexity is acceptable when it is required by real constraints.

### 7.1 Domain complexity

Regulatory workflows, enforcement lifecycles, audit trails, appeals, deadlines, roles, and legal constraints may require explicit state models and policy objects.

This is essential complexity, not over-engineering.

### 7.2 Security complexity

Authentication, authorization, encryption, audit logging, input validation, and data protection may require additional layers.

Security complexity MUST remain explicit and testable.

### 7.3 Reliability complexity

Retries, idempotency, circuit breakers, queues, backpressure, and outbox patterns are acceptable when failure modes justify them.

### 7.4 Performance complexity

Indexing, caching, batching, streaming, pooling, and concurrency are acceptable when performance requirements or measurements justify them.

### 7.5 Integration complexity

External systems may require adapters, translators, contract models, anti-corruption layers, and compatibility handling.

The complexity should be isolated at the boundary.

---

## 8. Forbidden Anti-Patterns

### 8.1 Architecture cosplay

Using impressive architecture patterns without need is forbidden.

Examples:

- CQRS for simple CRUD without read/write pressure;
- event sourcing without audit/replay requirement;
- microservice split for a module that has no independent lifecycle;
- plugin system for one implementation;
- generic rules engine for three stable if-statements;
- workflow engine for one linear flow.

### 8.2 Clever code

The LLM MUST NOT write code that is short but hard to understand.

Forbidden tendencies:

- dense one-liners;
- nested ternaries;
- implicit side effects;
- cryptic lambdas;
- excessive stream chains;
- overuse of generics;
- dynamic method names;
- reflection tricks;
- hidden mutation.

### 8.3 Pattern-first design

The LLM MUST NOT start from a pattern name.

Bad:

```text
This needs Strategy + Factory + Observer.
```

Good:

```text
There are two known fee calculation variants selected by licence type, so a small named policy interface is justified.
```

### 8.4 Configuration-driven everything

Moving logic from code into configuration is not automatically simpler.

A config-driven design is forbidden when:

- behavior becomes hard to trace;
- invalid config can break production;
- there is no validation;
- tests do not cover config combinations;
- operators become responsible for business logic;
- code loses type safety for no benefit.

### 8.5 Universal base classes

Generic base classes that attempt to standardize unrelated use cases are forbidden.

Symptoms:

- many protected hooks;
- template methods with unclear order;
- boolean flags changing behavior;
- subclasses overriding most methods;
- base class depends on domain-specific details.

### 8.6 Premature distribution

The LLM MUST NOT propose microservices, queues, distributed caches, separate databases, or cross-service sagas when a module or transaction is enough.

Distribution is a complexity multiplier.

---

## 9. Required Review Checklist

Before finalizing code, the LLM MUST verify:

- [ ] Is this the simplest correct solution for the actual requirement?
- [ ] Did I avoid speculative future features?
- [ ] Did I avoid unnecessary abstraction?
- [ ] Did I avoid unnecessary dependency/framework additions?
- [ ] Did I avoid unnecessary async/concurrency/caching?
- [ ] Did I use existing project conventions before inventing new ones?
- [ ] Is control flow easy to trace?
- [ ] Are failure cases explicit?
- [ ] Can this be tested without excessive mocking?
- [ ] Can this be deleted or replaced without large blast radius?
- [ ] Did I preserve essential domain complexity instead of hiding it?
- [ ] Did I document any unavoidable complexity?

If any answer indicates avoidable complexity, the LLM MUST simplify before completion.

---

## 10. Examples

### 10.1 Bad: plugin framework for one variation

```java
interface RulePlugin<T> {
    boolean supports(String type);
    RuleResult execute(T input, RuleContext context);
}

class RulePluginRegistry { ... }
class RulePluginLoader { ... }
class RuleExecutionEngine { ... }
```

If there is only one rule and no real plugin requirement, this violates KISS.

### 10.2 Good: direct domain policy

```java
final class AppealDeadlinePolicy {
    boolean isAppealAllowed(LocalDate decisionDate, LocalDate appealDate) {
        return !appealDate.isAfter(decisionDate.plusDays(14));
    }
}
```

This is simple, named, testable, and easy to replace later.

---

### 10.3 Bad: unnecessary async

```text
HTTP request -> queue -> worker -> database -> event -> projector -> poll status
```

For a fast atomic update, this is unnecessary complexity.

### 10.4 Good: synchronous transaction

```text
HTTP request -> service transaction -> database -> response
```

Use async only when latency, reliability, or process duration requires it.

---

### 10.5 Bad: clever stream chain

```java
return users.stream().collect(groupingBy(User::role)).entrySet().stream()
    .flatMap(e -> e.getValue().stream().filter(u -> u.active()).map(u -> ...))
    .collect(toMap(...));
```

### 10.6 Better: readable steps

```java
Map<Role, List<User>> usersByRole = groupUsersByRole(users);
List<User> activeUsers = selectActiveUsers(usersByRole);
return buildRoleSummary(activeUsers);
```

Readable intermediate names reduce cognitive load.

---

## 11. KISS vs Other Principles

### KISS vs DRY

Do not create a complicated abstraction just to remove harmless local duplication. DRY is about duplicated knowledge, not mechanically eliminating similar code.

### KISS vs SOLID

SOLID should improve changeability. If applying SOLID creates excessive interfaces, factories, and indirection for stable simple code, the design is not simple.

### KISS vs YAGNI

KISS and YAGNI reinforce each other. Do not build what is not needed. Keep the current design understandable so future change is cheap.

### KISS vs performance

Simple code is preferred until performance requirements or measurements justify complexity. Once performance complexity is introduced, isolate and test it.

### KISS vs enterprise architecture

Enterprise systems need reliability, auditability, security, and operability. These are real requirements. But enterprise context does not justify accidental complexity by default.

---

## 12. Complexity Justification Template

When the LLM introduces non-trivial complexity, it MUST provide this justification:

```text
Complexity introduced:
- <component/pattern/dependency>

Requirement or constraint:
- <specific requirement>

Failure mode avoided:
- <what breaks without it>

Simpler alternative considered:
- <simpler option>

Reason simpler alternative is insufficient:
- <specific reason>

Containment:
- <how complexity is isolated>

Tests:
- <tests proving behavior/failure handling>
```

If this template cannot be filled, the complexity MUST be removed.

---

## 13. LLM Implementation Protocol

When implementing code, the LLM MUST follow this protocol:

```text
KISS analysis:
- What is the real requirement?
- What is the simplest correct implementation?
- What complexity am I adding?
- Is each complexity item required by a known constraint?
- Can existing project conventions solve this?
- Can I remove one abstraction, dependency, config option, async step, or layer?
- Will the next maintainer understand this quickly?
```

The LLM MUST NOT present a complex solution as complete without this analysis.

---

## 14. Minimum Acceptance Criteria

A code change satisfies this standard only if:

1. it solves the actual current requirement;
2. it does not add speculative features;
3. it uses direct control flow unless indirection is justified;
4. every non-trivial complexity item has a clear reason;
5. it avoids unnecessary dependencies and frameworks;
6. it avoids unnecessary async, concurrency, caching, and distribution;
7. it keeps domain complexity explicit rather than hidden;
8. it is easy to test, debug, operate, and delete;
9. it follows existing project conventions where reasonable;
10. it passes the review checklist.

---

## 15. Sources Consulted

- KISS principle overview: `https://en.wikipedia.org/wiki/KISS_principle`
- Interaction Design Foundation, KISS design principle: `https://ixdf.org/literature/article/kiss-keep-it-simple-stupid-a-design-principle`
- W3C TAG, Rule of Least Power: `https://www.w3.org/2001/tag/doc/leastPower.html`
- Martin Fowler, YAGNI: `https://martinfowler.com/bliki/Yagni.html`
- Martin Fowler, Beck Design Rules: `https://martinfowler.com/bliki/BeckDesignRules.html`

---

## 16. Enforcement Snippet for LLM Agents

Use this snippet in agent instructions:

```text
When implementing code, apply KISS strictly. Start with the simplest correct solution for the current known requirement. Do not introduce abstractions, frameworks, dependencies, async workflows, caches, distributed components, reflection, generic engines, plugin systems, or extra configuration unless a concrete requirement or failure mode justifies them. Prefer explicit control flow, boring technology, narrow domain-named components, and code that is easy to read, test, debug, operate, and delete. Treat unnecessary complexity as a defect.
```
