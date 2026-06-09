# Task

<Task>

---

# Mode

<Agent Mode>

---

# Response

## Source hierarchy

Prefer evidence in this order:

1. Direct source code, migrations, tests, configuration, API contracts, scripts.
2. Generated evidence files in `.context/evidence/*.evidence.jsonl`.
3. Generated notebook files in `.context/notebook/*.md`.
4. Inference from multiple directly supported facts.
5. Assumption, clearly marked as assumption.

Do not present inference or assumption as fact.

## Claim classification

Classify important claims as:

- FACT: directly supported by code, config, migration, test, or documentation.
- INFERENCE: logically derived from multiple facts.
- ASSUMPTION: plausible but not proven by available source.
- UNKNOWN: not found or not verifiable from available source.

## Citation discipline

For factual claims about system behavior, include evidence when possible:

```text
source: path/to/file.ext:line_start-line_end
basis: direct_code | direct_config | direct_test | generated_evidence | inference
confidence: high | medium | low
```

Never invent citations. If evidence is missing, say: `i could not verify this from the available source.`

## Engineering perspectives

Always consider request flow, state transitions, data ownership, data dependencies, cross-service calls, events/messages, transaction boundaries, idempotency, concurrency, retries, auditability, access control, migration/rollback, observability, and failure modes.


---

# Mode Instructions

# Research Mode

Read-only mode. Answer questions using notebook, evidence, and source. Distinguish FACT, INFERENCE, ASSUMPTION, and UNKNOWN. Cite file paths and line ranges where available.

Expected output:

```md
## answer
## evidence-backed facts
## inferences
## unknowns
## risks / edge cases
## suggested next step
```


---

# Notebook

# Engineering Notebook Index

generated_at_utc: 2026-06-09T06:41:51.460854Z

## Detected services

- `service-a`
- `service-b`


# Service Catalog

| service | evidence records | endpoint | entity | repository | state | event |
|---|---:|---:|---:|---:|---:|---:|
| `service-a` | 10 | 2 | 1 | 1 | 3 | 0 |
| `service-b` | 2 | 0 | 0 | 0 | 0 | 2 |

# API Catalog

| claim | evidence | confidence |
|---|---|---|
| Spring controller annotation detected: @RestController | `services/service-a/src/main/java/example/CandidateController.java:7-7` | high |
| Spring mapping annotation detected: @RequestMapping("/candidates") | `services/service-a/src/main/java/example/CandidateController.java:8-8` | high |
| Spring mapping annotation detected: @PostMapping("/{candidateId}/submit") | `services/service-a/src/main/java/example/CandidateController.java:16-16` | high |


# Domain Model

| claim | evidence | confidence |
|---|---|---|
| Persistence entity annotation detected: @Entity | `services/service-a/src/main/java/example/Candidate.java:6-6` | high |
| Repository pattern detected: @Repository | `services/service-a/src/main/java/example/CandidateRepository.java:5-5` | medium |
| SQL table definition/change detected: CREATE TABLE candidate ( | `services/service-a/src/main/resources/db/migration/V1__candidate.sql:1-1` | high |


# State Machines

| claim | evidence | confidence |
|---|---|---|
| Possible status/state transition reference detected: this.status = status; | `services/service-a/src/main/java/example/Candidate.java:17-17` | medium |
| Possible status/state transition reference detected: if (candidate.getStatus() != CandidateStatus.DRAFT) { | `services/service-a/src/main/java/example/CandidateService.java:15-15` | medium |
| Possible status/state transition reference detected: candidate.setStatus(CandidateStatus.SUBMITTED); | `services/service-a/src/main/java/example/CandidateService.java:18-18` | medium |


# Request Flows

| claim | evidence | confidence |
|---|---|---|
| Spring mapping annotation detected: @RequestMapping("/candidates") | `services/service-a/src/main/java/example/CandidateController.java:8-8` | high |
| Spring mapping annotation detected: @PostMapping("/{candidateId}/submit") | `services/service-a/src/main/java/example/CandidateController.java:16-16` | high |
| Spring service annotation detected: @Service | `services/service-a/src/main/java/example/CandidateService.java:5-5` | high |


# Data Flows

| claim | evidence | confidence |
|---|---|---|
| Persistence entity annotation detected: @Entity | `services/service-a/src/main/java/example/Candidate.java:6-6` | high |
| Repository pattern detected: @Repository | `services/service-a/src/main/java/example/CandidateRepository.java:5-5` | medium |
| SQL table definition/change detected: CREATE TABLE candidate ( | `services/service-a/src/main/resources/db/migration/V1__candidate.sql:1-1` | high |


# Event Flows

| claim | evidence | confidence |
|---|---|---|
| Possible event/message behavior detected: export type CandidateSubmittedEvent = { | `services/service-b/src/main/ts/notification-consumer.ts:1-1` | low |
| Possible event/message behavior detected: export async function handleCandidateSubmitted(event: CandidateSubmittedEvent): Promise<void> { | `services/service-b/src/main/ts/notification-consumer.ts:6-6` | low |


# Dependency Matrix

| claim | evidence | confidence |
|---|---|---|
| Possible event/message behavior detected: export type CandidateSubmittedEvent = { | `services/service-b/src/main/ts/notification-consumer.ts:1-1` | low |
| Possible event/message behavior detected: export async function handleCandidateSubmitted(event: CandidateSubmittedEvent): Promise<void> { | `services/service-b/src/main/ts/notification-consumer.ts:6-6` | low |


# Failure Model

Check illegal transitions, duplicate processing, partial failure, stale reads, access control, auditability, migration, rollback, and observability.


# Open Questions

- Which detected state references are true legal transitions?
- Which operations require idempotency?
- Which tests prove behavior?


---

# Answer Contract

Distinguish FACT, INFERENCE, ASSUMPTION, and UNKNOWN. Cite paths and line ranges. If insufficient, say what source files should be inspected next.
