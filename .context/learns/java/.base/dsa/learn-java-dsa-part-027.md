# Learn Java DSA — Part 027
# Algorithm Design for Domain Workflows and State Machines

> Seri: `learn-java-dsa`  
> Part: `027` dari `030`  
> Fokus: mendesain algoritma dan struktur data untuk workflow domain, state machine, escalation, impact analysis, dependency graph, dan case-management engine berbasis Java.

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah mempelajari struktur data dan algoritma secara terpisah: array, map, set, tree, heap, graph, dynamic programming, greedy, sliding window, bitset, DSU, cache, concurrent structure, dan snapshot structure.

Bagian ini menyatukan semuanya ke dalam satu konteks yang sangat dekat dengan sistem nyata: **domain workflow** dan **state machine**.

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Melihat workflow bukan sebagai kumpulan `if-else`, tetapi sebagai **graph dengan invariant**.
2. Mendesain transition table yang eksplisit, auditable, testable, dan bisa berkembang.
3. Memisahkan antara:
   - state,
   - event/action,
   - transition,
   - guard,
   - effect,
   - policy,
   - actor permission,
   - domain invariant.
4. Memilih struktur data Java yang tepat untuk:
   - transition lookup,
   - allowed action lookup,
   - reachability analysis,
   - illegal transition detection,
   - escalation scheduling,
   - deadline query,
   - dependency impact propagation,
   - audit trail indexing.
5. Mendesain algoritma workflow yang bukan hanya benar untuk happy path, tetapi juga kuat terhadap:
   - race condition,
   - stale state,
   - duplicate command,
   - invalid transition,
   - partial failure,
   - cyclic dependency,
   - inconsistent configuration.
6. Membangun mental model top-tier: **workflow engine kecil adalah gabungan dari graph, map, queue, priority queue, sorted index, immutable snapshot, dan event log**.

---

## 1. Kenapa Workflow dan State Machine adalah Masalah DSA

Banyak engineer memperlakukan workflow sebagai kumpulan kode prosedural:

```java
if (caseStatus == DRAFT && action == SUBMIT) {
    status = PENDING_REVIEW;
} else if (caseStatus == PENDING_REVIEW && action == APPROVE) {
    status = APPROVED;
} else if (...) {
    ...
}
```

Pada skala kecil ini tampak cukup. Tetapi dalam sistem domain nyata, terutama sistem regulasi, case management, enforcement, approval, appeal, renewal, compliance, document review, atau escalation lifecycle, pendekatan ini cepat runtuh.

Masalahnya bukan hanya jumlah state. Masalahnya adalah interaksi antar konsep:

1. State bertambah.
2. Action bertambah.
3. Role/permission bertambah.
4. Guard condition bertambah.
5. Business rule berubah.
6. Effective date policy berubah.
7. Entity dependency bertambah.
8. Audit requirement meningkat.
9. Backward compatibility diperlukan.
10. Workflow versioning diperlukan.
11. Parallel user/action terjadi.
12. Retry dan idempotency diperlukan.
13. Reporting butuh query historis.

Jika semua itu ditulis sebagai `if-else`, maka kompleksitasnya tersembunyi.

DSA membantu mengubah workflow menjadi bentuk yang bisa dianalisis:

| Domain Concept | DSA View |
|---|---|
| State | Node/vertex |
| Transition | Directed edge |
| Action/event | Edge label/input |
| Guard | Predicate attached to edge |
| Role permission | Filter/index over actions |
| Terminal state | Node with no outgoing transition or explicit final marker |
| Allowed actions | Adjacency lookup |
| Reachability | Graph traversal |
| Invalid transition | Missing edge or failed guard |
| Escalation | Priority queue / sorted map |
| Deadline query | NavigableMap / heap |
| Dependency impact | Directed graph traversal |
| Duplicate grouping | DSU / hash index |
| Rule evaluation | Map/tree/trie/graph depending on shape |
| Audit trail | Append-only event sequence + secondary indexes |
| Workflow version | Immutable snapshot |

Dengan mental model ini, workflow tidak lagi sekadar prosedur. Workflow menjadi **struktur data yang bisa divalidasi, diuji, divisualisasikan, dan dievolusi**.

---

## 2. Model Dasar State Machine

State machine minimal memiliki:

1. Finite set of states.
2. Finite set of actions/events.
3. Transition relation.
4. Current state.
5. Transition function.

Secara konseptual:

```text
nextState = transition(currentState, action)
```

Tetapi untuk sistem domain nyata, bentuk tersebut terlalu sederhana. Biasanya transition juga dipengaruhi oleh:

1. Actor.
2. Role.
3. Ownership.
4. Case attributes.
5. Submitted documents.
6. Payment status.
7. Deadline status.
8. External system status.
9. Effective-date policy.
10. Workflow version.

Maka bentuk praktisnya menjadi:

```text
transitionResult = transition(
    currentState,
    action,
    actor,
    aggregateSnapshot,
    policySnapshot,
    currentTime
)
```

Namun invariant utamanya tetap sama:

> Sebuah entity hanya boleh pindah state melalui transition yang eksplisit dan valid.

---

## 3. Komponen Workflow yang Harus Dipisahkan

Kesalahan umum adalah mencampur semua concern ke dalam satu method besar:

```java
void approveCase(Case c, User u) {
    if (c.status() != PENDING_REVIEW) throw ...;
    if (!u.hasRole(REVIEWER)) throw ...;
    if (!c.hasRequiredDocs()) throw ...;
    c.setStatus(APPROVED);
    audit(...);
    notify(...);
}
```

Kode seperti ini tidak selalu salah, tetapi jika pattern tersebut tersebar di banyak method, workflow menjadi sulit dianalisis.

Lebih baik pisahkan komponen berikut.

### 3.1 State

State adalah posisi domain entity dalam lifecycle.

Contoh:

```java
enum CaseState {
    DRAFT,
    SUBMITTED,
    PENDING_REVIEW,
    PENDING_CLARIFICATION,
    APPROVED,
    REJECTED,
    WITHDRAWN,
    CLOSED
}
```

State harus menjawab: **entity ini sedang berada dalam fase apa?**

State bukan action. State bukan role. State bukan reason. State bukan UI tab.

### 3.2 Action / Event

Action adalah input yang mencoba mengubah state.

```java
enum CaseAction {
    SUBMIT,
    ASSIGN_REVIEWER,
    REQUEST_CLARIFICATION,
    RESPOND_CLARIFICATION,
    APPROVE,
    REJECT,
    WITHDRAW,
    CLOSE
}
```

Action harus menjawab: **apa yang diminta terjadi?**

### 3.3 Transition

Transition adalah edge dari satu state ke state lain akibat action tertentu.

```text
DRAFT --SUBMIT--> SUBMITTED
SUBMITTED --ASSIGN_REVIEWER--> PENDING_REVIEW
PENDING_REVIEW --APPROVE--> APPROVED
PENDING_REVIEW --REJECT--> REJECTED
```

Transition harus eksplisit.

Jika transition tidak eksplisit, sistem seharusnya menolak.

### 3.4 Guard

Guard adalah predicate yang harus benar agar transition boleh terjadi.

Contoh:

1. Required documents complete.
2. Actor has role reviewer.
3. Payment has been received.
4. No unresolved clarification.
5. Deadline has not expired.
6. Case is assigned to actor.
7. External verification succeeded.

Guard tidak seharusnya mengubah state. Guard hanya memutuskan boleh/tidak.

### 3.5 Effect

Effect adalah konsekuensi setelah transition valid.

Contoh:

1. Update state.
2. Append audit trail.
3. Create notification.
4. Schedule escalation.
5. Cancel pending task.
6. Publish domain event.
7. Generate document.

Effect boleh gagal. Karena itu effect perlu dipikirkan secara transactional dan idempotent.

### 3.6 Policy

Policy adalah aturan yang bisa berubah tanpa mengubah bentuk lifecycle inti.

Contoh:

1. SLA review 7 hari.
2. Appeal window 14 hari.
3. Auto-close setelah 30 hari.
4. Required document berbeda berdasarkan case type.
5. Threshold berbeda berdasarkan risk level.

Policy sebaiknya berada dalam snapshot/config terpisah dari transition topology.

---

## 4. Representasi Transition Table di Java

Untuk state/action berbasis enum, struktur data paling natural adalah `EnumMap` dan `EnumSet`.

Kenapa?

1. Key space finite.
2. State/action biasanya enum.
3. Lookup cepat.
4. Lebih compact daripada `HashMap` untuk enum key.
5. Iterasi mengikuti enum declaration order.
6. Semantics lebih eksplisit.

`EnumMap` memang didesain sebagai `Map` khusus untuk enum keys, sedangkan `EnumSet` adalah `Set` khusus enum yang direpresentasikan secara internal sebagai bit vector yang compact dan efisien menurut dokumentasi Java. Untuk allowed-action lookup, combination state/action, dan permission matrix, dua struktur ini biasanya lebih tepat daripada `HashMap<Enum, ...>` atau `HashSet<Enum>`.

### 4.1 Simple Transition Table

```java
import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;

public final class WorkflowDefinition {
    private final EnumMap<CaseState, EnumMap<CaseAction, CaseState>> transitions;

    public WorkflowDefinition(EnumMap<CaseState, EnumMap<CaseAction, CaseState>> transitions) {
        this.transitions = deepCopy(transitions);
    }

    public Optional<CaseState> nextState(CaseState current, CaseAction action) {
        var byAction = transitions.get(current);
        if (byAction == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(byAction.get(action));
    }

    public Map<CaseAction, CaseState> outgoing(CaseState state) {
        var byAction = transitions.get(state);
        if (byAction == null) {
            return Map.of();
        }
        return Map.copyOf(byAction);
    }

    private static EnumMap<CaseState, EnumMap<CaseAction, CaseState>> deepCopy(
            EnumMap<CaseState, EnumMap<CaseAction, CaseState>> input
    ) {
        var copy = new EnumMap<CaseState, EnumMap<CaseAction, CaseState>>(CaseState.class);
        for (var entry : input.entrySet()) {
            copy.put(entry.getKey(), new EnumMap<>(entry.getValue()));
        }
        return copy;
    }
}
```

This design gives us:

```text
state + action -> next state
```

Complexity:

| Operation | Complexity |
|---|---:|
| Lookup transition | O(1) practical for enum map |
| Get outgoing actions | O(k), k = outgoing actions |
| Validate all transitions | O(V + E) |
| Reachability | O(V + E) |

### 4.2 Why Not Switch Everywhere?

Switch is fine for tiny, stable workflows:

```java
return switch (current) {
    case DRAFT -> switch (action) {
        case SUBMIT -> SUBMITTED;
        default -> throw invalid();
    };
    ...
};
```

But table representation is better when you need:

1. Introspection.
2. Validation.
3. Visualization.
4. Versioning.
5. Export to documentation.
6. Dynamic policy attachment.
7. Reachability analysis.
8. Permission matrix derivation.
9. Testing all transitions systematically.

Rule of thumb:

| Situation | Better Approach |
|---|---|
| Tiny fixed lifecycle | `switch` may be okay |
| Auditable regulatory workflow | transition table |
| Runtime-configurable workflow | immutable workflow definition |
| Need graph analysis | adjacency representation |
| Need per-transition metadata | transition object |

---

## 5. Transition Object: Ketika Edge Butuh Metadata

Real transition biasanya tidak hanya punya `toState`.

Kita butuh:

1. From state.
2. Action.
3. To state.
4. Required role.
5. Guard list.
6. Effect list.
7. Reason requirement.
8. Audit label.
9. SLA rule.
10. Whether transition is terminal.
11. Whether transition is reversible.
12. Whether transition requires optimistic lock.

Contoh model:

```java
import java.util.List;
import java.util.Set;

public record Transition(
        CaseState from,
        CaseAction action,
        CaseState to,
        Set<Role> allowedRoles,
        List<Guard> guards,
        List<Effect> effects,
        String auditCode
) {
    public Transition {
        allowedRoles = Set.copyOf(allowedRoles);
        guards = List.copyOf(guards);
        effects = List.copyOf(effects);
    }
}
```

Transition table menjadi:

```java
public final class WorkflowGraph {
    private final EnumMap<CaseState, EnumMap<CaseAction, Transition>> index;

    public WorkflowGraph(List<Transition> transitions) {
        this.index = buildIndex(transitions);
        validateGraph(index);
    }

    public Optional<Transition> find(CaseState state, CaseAction action) {
        var byAction = index.get(state);
        if (byAction == null) return Optional.empty();
        return Optional.ofNullable(byAction.get(action));
    }

    private static EnumMap<CaseState, EnumMap<CaseAction, Transition>> buildIndex(List<Transition> transitions) {
        var result = new EnumMap<CaseState, EnumMap<CaseAction, Transition>>(CaseState.class);

        for (Transition t : transitions) {
            var byAction = result.computeIfAbsent(
                    t.from(),
                    ignored -> new EnumMap<>(CaseAction.class)
            );

            Transition previous = byAction.putIfAbsent(t.action(), t);
            if (previous != null) {
                throw new IllegalArgumentException(
                        "Duplicate transition for state=" + t.from() + ", action=" + t.action()
                );
            }
        }

        return result;
    }
}
```

The key invariant:

```text
For a deterministic workflow, there must be at most one transition per (fromState, action).
```

If multiple transitions exist for the same state/action with different guards, you have two options:

1. Reject the model and require distinct actions.
2. Allow ordered guarded transitions, but then you must define deterministic priority.

For regulatory systems, option 1 is often safer. Hidden priority among transitions can become hard to audit.

---

## 6. Guard Evaluation Design

Guard should be composable, named, and explainable.

Bad guard design:

```java
if (caseData.docs().size() > 3 && user.role().equals("R") && x && y && z) {
    ...
}
```

Better:

```java
public interface Guard {
    GuardResult evaluate(TransitionContext context);
}

public record GuardResult(
        boolean passed,
        String code,
        String message
) {
    public static GuardResult pass(String code) {
        return new GuardResult(true, code, "OK");
    }

    public static GuardResult fail(String code, String message) {
        return new GuardResult(false, code, message);
    }
}
```

Example guards:

```java
public final class RequiredDocumentsGuard implements Guard {
    @Override
    public GuardResult evaluate(TransitionContext context) {
        if (context.caseSnapshot().requiredDocumentsComplete()) {
            return GuardResult.pass("REQUIRED_DOCUMENTS_COMPLETE");
        }
        return GuardResult.fail(
                "REQUIRED_DOCUMENTS_INCOMPLETE",
                "Required documents are incomplete."
        );
    }
}
```

```java
public final class AssignedReviewerGuard implements Guard {
    @Override
    public GuardResult evaluate(TransitionContext context) {
        if (context.caseSnapshot().assignedReviewerId().equals(context.actor().id())) {
            return GuardResult.pass("ACTOR_IS_ASSIGNED_REVIEWER");
        }
        return GuardResult.fail(
                "ACTOR_NOT_ASSIGNED_REVIEWER",
                "Only the assigned reviewer can perform this transition."
        );
    }
}
```

### 6.1 Guard Evaluation Policy

Ada beberapa pilihan:

| Policy | Behavior | Use Case |
|---|---|---|
| Fail-fast | Stop at first failed guard | Low-cost validation, simple UX |
| Accumulate all failures | Evaluate all guards | Form validation, better error report |
| Severity-based | Continue only for warning/info | Complex compliance validation |
| Short-circuit expensive guards | Cheap guards first | External checks, expensive DB calls |

For workflow transition, common design:

1. Check transition existence first.
2. Check actor permission.
3. Check cheap local guards.
4. Check expensive external guards.
5. Execute transition.

This minimizes cost and produces clearer error semantics.

---

## 7. Transition Execution Algorithm

A robust transition algorithm should be explicit.

Pseudo-flow:

```text
executeTransition(command):
  1. Load aggregate by id
  2. Verify idempotency key / command id
  3. Verify expected version if supplied
  4. Find transition by currentState + action
  5. If missing: reject illegal transition
  6. Verify actor permission
  7. Evaluate guards
  8. If guard failed: reject with reasons
  9. Apply state change
 10. Append domain event / audit trail
 11. Persist atomically with optimistic lock
 12. Execute side effects via outbox or post-commit mechanism
 13. Return new state + audit/event id
```

Java-ish skeleton:

```java
public final class WorkflowEngine {
    private final WorkflowGraph graph;
    private final CaseRepository repository;
    private final IdempotencyStore idempotencyStore;
    private final Clock clock;

    public TransitionResult execute(TransitionCommand command) {
        return idempotencyStore.executeOnce(command.idempotencyKey(), () -> doExecute(command));
    }

    private TransitionResult doExecute(TransitionCommand command) {
        CaseAggregate aggregate = repository.findById(command.caseId())
                .orElseThrow(() -> new NotFoundException("Case not found: " + command.caseId()));

        if (command.expectedVersion().isPresent()
                && aggregate.version() != command.expectedVersion().getAsLong()) {
            throw new StaleStateException("Case version changed.");
        }

        Transition transition = graph.find(aggregate.state(), command.action())
                .orElseThrow(() -> new IllegalTransitionException(
                        aggregate.state(),
                        command.action()
                ));

        TransitionContext context = TransitionContext.from(command, aggregate.snapshot(), clock.instant());

        PermissionDecision permission = checkPermission(transition, context);
        if (!permission.allowed()) {
            throw new PermissionDeniedException(permission.reason());
        }

        List<GuardResult> guardResults = evaluateGuards(transition, context);
        List<GuardResult> failures = guardResults.stream()
                .filter(result -> !result.passed())
                .toList();

        if (!failures.isEmpty()) {
            throw new GuardFailedException(failures);
        }

        aggregate.transitionTo(transition.to(), command.actorId(), command.reason(), clock.instant());

        repository.saveWithOptimisticLock(aggregate);

        return new TransitionResult(
                aggregate.id(),
                transition.from(),
                transition.to(),
                aggregate.version()
        );
    }
}
```

Important invariant:

```text
The persisted state change and the audit/domain event must be atomic from business perspective.
```

If state changes without audit, you lose defensibility.
If audit exists without state change, you create false history.

In production, this usually means:

1. Same database transaction for aggregate update and audit/outbox insert.
2. Side effects triggered after commit.
3. Idempotency key to prevent duplicate command execution.
4. Optimistic lock to prevent lost update.

---

## 8. Workflow as Graph: Validation Algorithms

Once workflow is represented as graph, we can validate it.

Let:

```text
V = states
E = transitions
```

Basic validations:

1. All transition `from` and `to` states are known.
2. No duplicate `(from, action)` edge for deterministic workflows.
3. Initial state exists.
4. Terminal states are declared.
5. Terminal states do not have outgoing transitions unless explicitly allowed.
6. Non-terminal states have at least one outgoing transition unless intentionally waiting states.
7. All required states are reachable from initial state.
8. No accidental dead-end.
9. No forbidden cycle.
10. No transition bypasses mandatory review states.
11. Every transition has audit code.
12. Every external effect has idempotency key strategy.

### 8.1 Reachability from Initial State

```java
public Set<CaseState> reachableFrom(CaseState initial) {
    var visited = EnumSet.noneOf(CaseState.class);
    var queue = new ArrayDeque<CaseState>();

    visited.add(initial);
    queue.add(initial);

    while (!queue.isEmpty()) {
        CaseState state = queue.removeFirst();
        for (Transition transition : outgoingTransitions(state)) {
            if (visited.add(transition.to())) {
                queue.addLast(transition.to());
            }
        }
    }

    return visited;
}
```

Validation:

```java
EnumSet<CaseState> allStates = EnumSet.allOf(CaseState.class);
Set<CaseState> reachable = graph.reachableFrom(CaseState.DRAFT);

EnumSet<CaseState> unreachable = EnumSet.copyOf(allStates);
unreachable.removeAll(reachable);

if (!unreachable.isEmpty()) {
    throw new WorkflowDefinitionException("Unreachable states: " + unreachable);
}
```

### 8.2 Dead-End Detection

A state is a dead-end if:

1. It is not terminal.
2. It has no outgoing transition.

```java
public EnumSet<CaseState> deadEnds(Set<CaseState> terminalStates) {
    var result = EnumSet.noneOf(CaseState.class);

    for (CaseState state : CaseState.values()) {
        boolean terminal = terminalStates.contains(state);
        boolean hasOutgoing = !outgoingTransitions(state).isEmpty();

        if (!terminal && !hasOutgoing) {
            result.add(state);
        }
    }

    return result;
}
```

### 8.3 Cycle Detection

Cycles are not always wrong. For example:

```text
PENDING_REVIEW -> PENDING_CLARIFICATION -> PENDING_REVIEW
```

This can be valid.

But accidental cycles are dangerous:

```text
APPROVED -> PENDING_REVIEW
CLOSED -> SUBMITTED
REJECTED -> DRAFT
```

You need policy:

1. Which cycles are allowed?
2. Which states are irreversible?
3. Which terminal states must be absorbing?
4. Which transitions require special permission?

DFS cycle detection:

```java
public final class CycleDetector {
    enum Color { WHITE, GRAY, BLACK }

    public boolean hasCycle(WorkflowGraph graph) {
        var color = new EnumMap<CaseState, Color>(CaseState.class);
        for (CaseState state : CaseState.values()) {
            color.put(state, Color.WHITE);
        }

        for (CaseState state : CaseState.values()) {
            if (color.get(state) == Color.WHITE && dfs(state, color, graph)) {
                return true;
            }
        }
        return false;
    }

    private boolean dfs(CaseState state, EnumMap<CaseState, Color> color, WorkflowGraph graph) {
        color.put(state, Color.GRAY);

        for (Transition transition : graph.outgoingTransitions(state)) {
            CaseState next = transition.to();
            Color nextColor = color.get(next);

            if (nextColor == Color.GRAY) {
                return true;
            }
            if (nextColor == Color.WHITE && dfs(next, color, graph)) {
                return true;
            }
        }

        color.put(state, Color.BLACK);
        return false;
    }
}
```

But in domain workflow, a better validation is not simply “cycle or no cycle”. It is:

```text
Are all cycles explicitly allowed and bounded by business semantics?
```

Example: clarification loop is allowed, but may need a max count or escalation after repeated requests.

---

## 9. Permission Matrix as Data Structure

Permission should not be scattered across transition methods.

For enum-based roles/actions/states:

```java
EnumMap<Role, EnumMap<CaseState, EnumSet<CaseAction>>> permissions;
```

Lookup:

```java
boolean can(Role role, CaseState state, CaseAction action) {
    var byState = permissions.get(role);
    if (byState == null) return false;

    var actions = byState.get(state);
    return actions != null && actions.contains(action);
}
```

Complexity: practical O(1).

Alternative index shapes:

| Query Pattern | Structure |
|---|---|
| Can role do action in state? | `EnumMap<Role, EnumMap<State, EnumSet<Action>>>` |
| Which actions are available for user now? | `EnumMap<State, EnumSet<Action>>` filtered by role/guard |
| Which roles can perform action? | `EnumMap<Action, EnumSet<Role>>` |
| Audit permission coverage | transition list + permission matrix validation |

### 9.1 Allowed Actions for UI

A frequent requirement:

> Given case + user, show allowed buttons.

Algorithm:

```text
allowedActions(case, user):
  1. Get outgoing transitions for current state
  2. Filter by role permission
  3. Optionally evaluate cheap guards
  4. Return action + disabled reason / enabled status
```

Do not hide every failed guard silently. For good UX and auditability, return reason:

```java
public record ActionAvailability(
        CaseAction action,
        boolean enabled,
        List<String> reasons
) {}
```

This allows UI to show:

1. Button enabled.
2. Button disabled with reason.
3. Button hidden because actor has no permission.

Those are different semantics.

---

## 10. Escalation as Priority Queue / Sorted Index

Escalation is DSA problem.

Common requirement:

1. Case has deadline.
2. Earliest deadline should be processed first.
3. Some cases have higher severity.
4. Some escalations are cancelled when state changes.
5. Some escalations are rescheduled.
6. Need query: “what escalations are due now?”

Candidate structures:

| Requirement | Structure |
|---|---|
| Process earliest due first | `PriorityQueue` |
| Query range by deadline | `TreeMap<Instant, List<Task>>` / `NavigableMap` |
| Cancel by task id | `HashMap<TaskId, Task>` + lazy deletion |
| Reschedule | remove+insert or lazy invalidation |
| Multi-priority | heap comparator or bucketed queues |

Java `PriorityQueue` is an unbounded priority queue based on a priority heap. It orders elements by natural ordering or a comparator supplied at construction. This is a good fit for “give me next due task”, but not for arbitrary removal or range query.

### 10.1 PriorityQueue Escalation Scheduler

```java
public record EscalationTask(
        String taskId,
        String caseId,
        Instant dueAt,
        int severity,
        long version
) {}
```

Comparator:

```java
Comparator<EscalationTask> escalationOrder =
        Comparator.comparing(EscalationTask::dueAt)
                .thenComparing(Comparator.comparingInt(EscalationTask::severity).reversed())
                .thenComparing(EscalationTask::taskId);
```

Scheduler:

```java
public final class EscalationQueue {
    private final PriorityQueue<EscalationTask> heap;
    private final Map<String, EscalationTask> latestByTaskId;

    public EscalationQueue() {
        this.heap = new PriorityQueue<>(
                Comparator.comparing(EscalationTask::dueAt)
                        .thenComparing(Comparator.comparingInt(EscalationTask::severity).reversed())
                        .thenComparing(EscalationTask::taskId)
        );
        this.latestByTaskId = new HashMap<>();
    }

    public void schedule(EscalationTask task) {
        latestByTaskId.put(task.taskId(), task);
        heap.add(task);
    }

    public void cancel(String taskId) {
        latestByTaskId.remove(taskId);
    }

    public List<EscalationTask> pollDue(Instant now, int limit) {
        var due = new ArrayList<EscalationTask>(limit);

        while (!heap.isEmpty() && due.size() < limit) {
            EscalationTask head = heap.peek();

            if (head.dueAt().isAfter(now)) {
                break;
            }

            heap.remove();

            EscalationTask latest = latestByTaskId.get(head.taskId());
            if (latest == null) {
                continue; // cancelled
            }
            if (!latest.equals(head)) {
                continue; // stale rescheduled version
            }

            latestByTaskId.remove(head.taskId());
            due.add(head);
        }

        return due;
    }
}
```

This uses **lazy deletion**.

Why?

`PriorityQueue.remove(object)` is not the operation we want to depend on heavily for large queues. A heap is excellent for polling min/max priority, but poor for arbitrary indexed deletion unless we maintain extra heap position indexes ourselves.

Lazy deletion invariant:

```text
Heap may contain stale tasks, but latestByTaskId defines truth.
```

### 10.2 When NavigableMap is Better

If the dominant query is:

```text
Give me all tasks due between T1 and T2.
```

Use sorted index:

```java
NavigableMap<Instant, List<EscalationTask>> byDueAt = new TreeMap<>();
```

Java `NavigableMap` supports relational/range navigation such as lower/floor/ceiling/higher and sub-map views. This makes it natural for deadline windows and effective-date policies.

Range query:

```java
public List<EscalationTask> dueBetween(Instant fromInclusive, Instant toExclusive) {
    return byDueAt.subMap(fromInclusive, true, toExclusive, false)
            .values()
            .stream()
            .flatMap(List::stream)
            .toList();
}
```

Trade-off:

| Structure | Strength | Weakness |
|---|---|---|
| `PriorityQueue` | next due task | range query/cancel hard |
| `TreeMap<Instant, List<Task>>` | range query | next min still okay but grouping management needed |
| `HashMap<TaskId, Task>` | direct cancel/update | no ordering |
| Heap + HashMap | next due + cancel via lazy deletion | stale heap entries accumulate |

---

## 11. Deadline and Effective-Date Policy

Many domain systems need effective-date resolution:

> Given a date/time, which policy applies?

Examples:

1. SLA changed from 7 days to 5 days starting 2026-01-01.
2. Fee rule changes by effective date.
3. Required document changes by application date.
4. Risk threshold changes by policy version.

This is not a plain `HashMap` problem because lookup is not exact key lookup.

We need nearest lower/equal effective date:

```text
policy = floorEntry(effectiveAt)
```

Using `NavigableMap`:

```java
public final class EffectivePolicyIndex<P> {
    private final NavigableMap<Instant, P> byEffectiveFrom;

    public EffectivePolicyIndex(NavigableMap<Instant, P> byEffectiveFrom) {
        this.byEffectiveFrom = new TreeMap<>(byEffectiveFrom);
    }

    public Optional<P> resolve(Instant at) {
        Map.Entry<Instant, P> entry = byEffectiveFrom.floorEntry(at);
        return entry == null ? Optional.empty() : Optional.of(entry.getValue());
    }
}
```

Complexity:

| Operation | Complexity |
|---|---:|
| Insert policy version | O(log n) |
| Resolve policy by date | O(log n) |
| Query policy range | O(log n + k) |

This is a classic example of choosing sorted map instead of hash map because the required operation is relational, not exact.

---

## 12. Dependency Impact as Graph Traversal

In domain systems, entities depend on each other.

Examples:

1. Case depends on application.
2. Application depends on documents.
3. Review decision depends on screening result.
4. Compliance case depends on inspection finding.
5. Appeal depends on original decision.
6. Renewal depends on active license.
7. Enforcement action depends on violation finding.

When one entity changes, we need impact analysis:

> If X changes, what else may be affected?

That is graph traversal.

### 12.1 Graph Representation

```java
public record EntityRef(String type, String id) {}
```

Dependency graph:

```java
public final class DependencyGraph {
    private final Map<EntityRef, Set<EntityRef>> outgoing;

    public DependencyGraph(Map<EntityRef, Set<EntityRef>> outgoing) {
        this.outgoing = copy(outgoing);
    }

    public Set<EntityRef> impactedBy(EntityRef changed) {
        var visited = new HashSet<EntityRef>();
        var queue = new ArrayDeque<EntityRef>();

        visited.add(changed);
        queue.add(changed);

        while (!queue.isEmpty()) {
            EntityRef current = queue.removeFirst();
            for (EntityRef next : outgoing.getOrDefault(current, Set.of())) {
                if (visited.add(next)) {
                    queue.addLast(next);
                }
            }
        }

        visited.remove(changed);
        return visited;
    }

    private static Map<EntityRef, Set<EntityRef>> copy(Map<EntityRef, Set<EntityRef>> input) {
        var result = new HashMap<EntityRef, Set<EntityRef>>();
        for (var entry : input.entrySet()) {
            result.put(entry.getKey(), Set.copyOf(entry.getValue()));
        }
        return Map.copyOf(result);
    }
}
```

### 12.2 Direction Matters

Be very explicit about edge direction.

Option A:

```text
A -> B means A depends on B
```

Option B:

```text
A -> B means A affects B
```

Both are valid, but mixing them is disastrous.

For impact analysis, I prefer:

```text
A -> B means change in A may impact B
```

Then BFS/DFS from changed entity gives impacted entities directly.

For dependency validation, you may also maintain reverse index:

```java
Map<EntityRef, Set<EntityRef>> dependentsByDependency;
Map<EntityRef, Set<EntityRef>> dependenciesByDependent;
```

This doubles storage but makes both query directions efficient.

---

## 13. State Machine + Dependency Graph

The powerful model appears when state machine and dependency graph are combined.

Example:

```text
Case C1 is PENDING_REVIEW.
Document D1 is replaced.
Screening Result S1 becomes stale.
Review Decision R1 depends on S1.
Case C1 depends on R1.
```

Then a document change may invalidate a pending review.

Algorithm:

```text
onEntityChanged(entity):
  impacted = dependencyGraph.impactedBy(entity)
  for each impacted entity:
    determine invalidation policy
    if entity has workflow state:
      transition to NEEDS_REVIEW / STALE / PENDING_RECALCULATION
    append audit trail
    schedule recalculation/escalation if needed
```

This is how DSA becomes domain architecture.

### 13.1 Impact Policy Table

```java
enum ImpactType {
    NONE,
    MARK_STALE,
    REQUIRE_REVIEW,
    BLOCK_TRANSITION,
    AUTO_RECALCULATE
}
```

Policy:

```java
EnumMap<EntityType, EnumMap<EntityType, ImpactType>> impactPolicy;
```

Example:

| Changed Entity | Impacted Entity | Impact |
|---|---|---|
| DOCUMENT | SCREENING_RESULT | AUTO_RECALCULATE |
| SCREENING_RESULT | REVIEW_DECISION | MARK_STALE |
| REVIEW_DECISION | CASE | REQUIRE_REVIEW |
| PAYMENT | CASE | BLOCK_TRANSITION until resolved |

Now impact behavior is no longer hidden in procedural code.

---

## 14. Audit Trail as Append-Only Structure + Indexes

Workflow without audit is weak for regulatory systems.

Audit trail should answer:

1. What happened?
2. Who did it?
3. When?
4. From which state?
5. To which state?
6. Why?
7. Which rule/guard allowed or rejected it?
8. Which source command caused it?
9. Was it retried?
10. Which workflow version applied?

### 14.1 Audit Event Model

```java
public record WorkflowAuditEvent(
        String eventId,
        String aggregateId,
        String workflowName,
        int workflowVersion,
        CaseState fromState,
        CaseState toState,
        CaseAction action,
        String actorId,
        Instant occurredAt,
        String reason,
        String commandId,
        List<String> passedGuards,
        List<String> failedGuards
) {}
```

### 14.2 In-Memory Audit Index Mental Model

For production, audit is persisted in DB/log storage. But DSA thinking helps define indexes:

| Query | Index Shape |
|---|---|
| Events by aggregate | `Map<AggregateId, List<Event>>` |
| Events by actor | `Map<ActorId, List<Event>>` |
| Events by time range | `NavigableMap<Instant, List<Event>>` |
| Events by action | `EnumMap<Action, List<Event>>` |
| Events by from/to state | `Map<StateTransitionKey, List<Event>>` |
| Latest state | `Map<AggregateId, State>` |

Audit index design should be query-driven.

Do not build indexes “just in case”. Every index adds:

1. Write cost.
2. Storage cost.
3. Consistency cost.
4. Migration cost.
5. Backfill cost.

---

## 15. Immutable Workflow Snapshot

Workflow definition should usually be immutable at runtime.

Why?

1. Request A and Request B should not see half-updated rules.
2. Audit event must know which workflow version applied.
3. Reproducibility matters.
4. Concurrent reads become simpler.
5. Validation can happen before publishing.

Design:

```java
public record WorkflowSnapshot(
        String workflowName,
        int version,
        CaseState initialState,
        Set<CaseState> terminalStates,
        WorkflowGraph graph,
        PermissionMatrix permissionMatrix,
        EffectivePolicyIndex<SlaPolicy> slaPolicies
) {}
```

Publication model:

```java
public final class WorkflowRegistry {
    private final AtomicReference<WorkflowSnapshot> current = new AtomicReference<>();

    public WorkflowSnapshot current() {
        return current.get();
    }

    public void publish(WorkflowSnapshot snapshot) {
        validate(snapshot);
        current.set(snapshot);
    }
}
```

Invariant:

```text
Only fully validated snapshots may be published.
```

This is the same idea as copy-on-write/snapshot structure from Part 026.

---

## 16. Illegal Transition Handling

Illegal transition must be treated as a first-class domain outcome.

Do not collapse everything into generic `400 Bad Request` internally.

Different illegal cases:

| Case | Meaning |
|---|---|
| Unknown action | Client sent invalid action |
| No transition from current state | Action not valid now |
| Actor lacks permission | Authorization/domain permission failure |
| Guard failed | Action known but domain precondition not met |
| Stale version | State changed since client loaded data |
| Terminal state | Entity lifecycle already completed |
| Workflow version mismatch | Client used outdated workflow definition |

Model them separately:

```java
sealed interface TransitionFailure permits
        UnknownActionFailure,
        MissingTransitionFailure,
        PermissionFailure,
        GuardFailure,
        StaleVersionFailure,
        TerminalStateFailure {}
```

This gives better:

1. UI message.
2. Audit classification.
3. Metrics.
4. Alerting.
5. Retry behavior.
6. Security analysis.

### 16.1 Retry Semantics

Not all failures are retryable.

| Failure | Retry? |
|---|---|
| Stale version | Yes, after reload/rebase |
| Guard failed due missing document | Yes, after fixing document |
| Permission failure | Usually no |
| Unknown action | No |
| Missing transition | No unless workflow changed |
| External temporary check failed | Yes with controlled retry |

This matters for workflow APIs and job processors.

---

## 17. Idempotency and Duplicate Commands

Workflow commands are often retried due to:

1. Network timeout.
2. Client retry.
3. Message redelivery.
4. Worker crash.
5. DB transient error.
6. User double-click.

Without idempotency, duplicate commands can cause:

1. Double approval.
2. Duplicate notification.
3. Duplicate audit trail.
4. Duplicate payment instruction.
5. Incorrect escalation.

### 17.1 Idempotency Key Index

```java
public record CommandResultKey(String aggregateId, String idempotencyKey) {}
```

Store:

```java
Map<CommandResultKey, TransitionResult> processedCommands;
```

Production version should persist this with uniqueness constraint.

Algorithm:

```text
execute command:
  if idempotency key already exists:
    return stored result
  else:
    execute transition in transaction
    store result keyed by idempotency key
```

Important invariant:

```text
Idempotency record must be committed atomically with state transition.
```

Otherwise, crash between state update and idempotency record insert can still duplicate effects.

---

## 18. Optimistic Locking and State Freshness

Workflow update should usually include version check.

Example:

```text
User A loads case at version 10.
User B approves case, version becomes 11.
User A tries to reject using stale version 10.
```

Without version check, last write may win incorrectly.

Command:

```java
public record TransitionCommand(
        String commandId,
        String idempotencyKey,
        String caseId,
        long expectedVersion,
        CaseAction action,
        String actorId,
        String reason
) {}
```

Repository operation:

```sql
UPDATE cases
SET state = ?, version = version + 1
WHERE id = ? AND version = ?
```

If affected rows = 0, reject as stale.

This is not only database technique. It is part of algorithm correctness:

```text
transition(currentState, action) is valid only for the state that was actually read.
```

---

## 19. Designing State Invariants

A state machine is only useful if state meanings are crisp.

Bad state names:

```text
PROCESSING
PENDING
DONE
ACTIVE
INACTIVE
```

These are often too vague.

Better state names encode lifecycle meaning:

```text
DRAFT
SUBMITTED
PENDING_REVIEW
PENDING_CLARIFICATION
APPROVED
REJECTED
WITHDRAWN
CLOSED
```

For each state, define invariants:

### DRAFT

```text
- Case may be edited by applicant.
- Case has not entered formal review.
- No reviewer assignment required.
- Submission audit not yet created.
```

### SUBMITTED

```text
- Case is formally received.
- Applicant cannot freely edit core fields.
- Intake validation must be complete or scheduled.
- Review assignment may be pending.
```

### PENDING_REVIEW

```text
- Case has assigned reviewer.
- Required documents must be present or explicitly waived.
- Review decision has not been finalized.
```

### PENDING_CLARIFICATION

```text
- Clarification request exists.
- Applicant/user response is expected.
- Review SLA may be paused or separately tracked depending on policy.
```

### APPROVED

```text
- Final positive decision exists.
- Approval audit exists.
- Approval document may be generated.
- Normal review transitions are no longer allowed.
```

### REJECTED

```text
- Final negative decision exists.
- Rejection reason is mandatory.
- Appeal window may be open.
```

### CLOSED

```text
- No ordinary transition allowed.
- Only exceptional administrative correction may be possible.
```

State invariant checklist:

1. Who can act in this state?
2. Which fields are editable?
3. Which documents are required?
4. Which timers are active?
5. Which external integrations are allowed?
6. Which outgoing transitions exist?
7. Is this state terminal?
8. Is this state reversible?
9. What audit evidence must exist?
10. What queries/reports depend on this state?

---

## 20. Avoiding State Explosion

State explosion happens when you encode too many independent dimensions into one enum.

Bad:

```text
PENDING_REVIEW_PAYMENT_UNPAID_DOC_INCOMPLETE_HIGH_RISK
PENDING_REVIEW_PAYMENT_PAID_DOC_INCOMPLETE_HIGH_RISK
PENDING_REVIEW_PAYMENT_PAID_DOC_COMPLETE_HIGH_RISK
PENDING_REVIEW_PAYMENT_PAID_DOC_COMPLETE_LOW_RISK
...
```

This is not lifecycle state anymore. It is Cartesian product.

Separate dimensions:

```java
enum CaseState { DRAFT, SUBMITTED, PENDING_REVIEW, APPROVED, REJECTED }
enum PaymentState { NOT_REQUIRED, PENDING, PAID, FAILED, REFUNDED }
enum DocumentState { INCOMPLETE, COMPLETE, WAIVED }
enum RiskLevel { LOW, MEDIUM, HIGH }
```

Then use guards/policies:

```text
APPROVE requires:
  CaseState = PENDING_REVIEW
  PaymentState = PAID or NOT_REQUIRED
  DocumentState = COMPLETE or WAIVED
  RiskLevel-specific review completed
```

Rule:

```text
Lifecycle state should represent lifecycle phase, not every attribute combination.
```

Use separate state machines if dimensions evolve independently.

---

## 21. Hierarchical and Parallel State Machines

Sometimes simple flat state is insufficient.

Example:

```text
Case lifecycle:
  DRAFT -> SUBMITTED -> UNDER_PROCESSING -> FINALIZED

Inside UNDER_PROCESSING:
  Review sub-state
  Payment sub-state
  Document sub-state
```

Instead of exploding state, use:

1. Parent lifecycle state.
2. Sub-state machines.
3. Derived readiness.

Example:

```java
public record CaseWorkflowStatus(
        CaseState caseState,
        ReviewState reviewState,
        PaymentState paymentState,
        DocumentState documentState
) {}
```

Then action availability is computed from multiple dimensions.

This is more complex, but often more truthful.

Checklist before using parallel state machines:

1. Are dimensions truly independent?
2. Can they transition separately?
3. Do they have separate audit trails?
4. Do they have separate owners?
5. Do they have separate SLAs?
6. Are cross-dimension guards explicit?

---

## 22. Workflow Versioning

Workflow changes over time.

Examples:

1. New state added.
2. Transition removed.
3. Guard changed.
4. SLA changed.
5. Role permission changed.
6. Terminal behavior changed.

Core question:

> Existing cases should follow old workflow or new workflow?

Options:

| Strategy | Description | Risk |
|---|---|---|
| All cases use latest | Simple | Historical inconsistency |
| Case pinned to workflow version | Auditable | Migration needed |
| Version by effective date | Policy-driven | More complex lookup |
| Hybrid | Topology pinned, policy effective-dated | Most realistic but complex |

For regulatory defensibility, pinning workflow version per case is often safer.

```java
public record CaseAggregate(
        String id,
        CaseState state,
        int workflowVersion,
        long version
) {}
```

Engine then resolves:

```java
WorkflowSnapshot snapshot = workflowRegistry.get(case.workflowVersion());
```

If you migrate existing cases, migration itself must be auditable.

---

## 23. Testing Workflow Algorithms

Workflow tests should not only test individual methods.

You need layers.

### 23.1 Definition Validation Tests

Test workflow graph itself:

1. No duplicate state/action pair.
2. All states reachable.
3. Terminal states have no normal outgoing transitions.
4. Required audit code exists.
5. Required guards exist.
6. Allowed cycles are explicitly declared.
7. Forbidden transitions do not exist.

### 23.2 Transition Matrix Tests

Generate tests from transition table:

```text
For every state S:
  For every action A:
    if transition exists:
      assert valid under passing guards
    else:
      assert illegal transition
```

This prevents accidental new action from being untested.

### 23.3 Guard Tests

Each guard should have focused tests:

1. Pass case.
2. Fail case.
3. Null/missing data case.
4. Boundary case.
5. Time-dependent case.

### 23.4 Execution Tests

Test full command execution:

1. State updated.
2. Version incremented.
3. Audit event appended.
4. Outbox event created.
5. Idempotency works.
6. Stale version rejected.
7. Duplicate command returns same result.

### 23.5 Property Tests

Useful properties:

1. Terminal states cannot transition through normal actions.
2. Every successful transition changes audit trail length by one.
3. Every persisted state is one of known states.
4. Every transition result matches transition table.
5. Replaying audit events reconstructs current state.

---

## 24. Metrics and Observability

Workflow engine should emit metrics by structured dimensions.

Useful counters:

1. Transition attempts by action/state.
2. Transition success by action/state.
3. Illegal transition count.
4. Guard failure count by guard code.
5. Permission denial count.
6. Stale version conflict count.
7. Idempotency replay count.
8. Escalation due count.
9. Escalation processed count.
10. Workflow definition validation failure count.

Useful latency measurements:

1. Guard evaluation latency.
2. Transition execution latency.
3. Repository save latency.
4. Side-effect dispatch latency.
5. Escalation polling latency.

Important: metrics labels must have bounded cardinality.

Good label:

```text
state=PENDING_REVIEW
action=APPROVE
guard=REQUIRED_DOCUMENTS_COMPLETE
```

Bad label:

```text
caseId=CASE-123456789
actorId=user@email.com
reasonText=free text
```

---

## 25. Common Workflow Anti-Patterns

### 25.1 If-Else Lifecycle Spread Everywhere

Symptom:

```text
State transition rules are duplicated across service methods, controllers, jobs, and UI logic.
```

Consequence:

1. Inconsistent allowed actions.
2. Hard to audit.
3. Hard to test all transitions.
4. Bug appears only in specific entry point.

Fix:

Centralize transition definition and execution.

### 25.2 State Without Invariant

Symptom:

```text
Nobody can explain what PENDING means exactly.
```

Fix:

Document state invariants.

### 25.3 Guard with Side Effect

Symptom:

```java
if (externalService.verifyAndUpdate(...)) { ... }
```

Consequence:

1. Repeated validation changes data.
2. Button availability check triggers mutation.
3. Failed transition leaves side effects.

Fix:

Guard should be read-only. Effects happen after transition decision.

### 25.4 Terminal State Not Absorbing

Symptom:

```text
Closed case can accidentally return to pending due admin action.
```

Fix:

Terminal states must have explicit exception handling.

### 25.5 Cache of Workflow Definition Mutated In-Place

Symptom:

```text
During config reload, some requests see partial workflow.
```

Fix:

Build immutable snapshot, validate, then atomically publish.

### 25.6 No Workflow Version in Audit

Symptom:

```text
Audit says action was valid, but current workflow says it is invalid.
```

Fix:

Audit event must store workflow version.

### 25.7 Using State to Encode Permission

Bad:

```text
PENDING_REVIEW_BY_MANAGER
PENDING_REVIEW_BY_OFFICER
```

Fix:

Keep state and permission separate.

### 25.8 No Idempotency

Symptom:

```text
Retry creates duplicate audit/event/notification.
```

Fix:

Command id/idempotency key with atomic result storage.

### 25.9 No Impact Graph

Symptom:

```text
Document changed but related review remains approved incorrectly.
```

Fix:

Model dependency graph and invalidation policy.

---

## 26. Design Example: Case Review Workflow

### 26.1 States

```java
enum CaseState {
    DRAFT,
    SUBMITTED,
    PENDING_REVIEW,
    PENDING_CLARIFICATION,
    APPROVED,
    REJECTED,
    WITHDRAWN,
    CLOSED
}
```

### 26.2 Actions

```java
enum CaseAction {
    SUBMIT,
    ASSIGN_REVIEWER,
    REQUEST_CLARIFICATION,
    RESPOND_CLARIFICATION,
    APPROVE,
    REJECT,
    WITHDRAW,
    CLOSE
}
```

### 26.3 Transition Table

| From | Action | To |
|---|---|---|
| DRAFT | SUBMIT | SUBMITTED |
| SUBMITTED | ASSIGN_REVIEWER | PENDING_REVIEW |
| PENDING_REVIEW | REQUEST_CLARIFICATION | PENDING_CLARIFICATION |
| PENDING_CLARIFICATION | RESPOND_CLARIFICATION | PENDING_REVIEW |
| PENDING_REVIEW | APPROVE | APPROVED |
| PENDING_REVIEW | REJECT | REJECTED |
| DRAFT | WITHDRAW | WITHDRAWN |
| SUBMITTED | WITHDRAW | WITHDRAWN |
| APPROVED | CLOSE | CLOSED |
| REJECTED | CLOSE | CLOSED |
| WITHDRAWN | CLOSE | CLOSED |

### 26.4 Guards

| Action | Guard |
|---|---|
| SUBMIT | required fields complete |
| ASSIGN_REVIEWER | actor is supervisor |
| REQUEST_CLARIFICATION | actor is assigned reviewer |
| RESPOND_CLARIFICATION | clarification response complete |
| APPROVE | documents complete, payment valid, actor assigned reviewer |
| REJECT | rejection reason provided, actor assigned reviewer |
| WITHDRAW | actor is applicant or admin |
| CLOSE | terminal decision exists |

### 26.5 Derived Indexes

From transition list, derive:

1. `transitionByStateAction`
2. `outgoingByState`
3. `incomingByState`
4. `actionsByState`
5. `statesByAction`
6. `terminalStates`
7. `roleActionMatrix`

This is important: do not manually maintain multiple indexes unless necessary. Prefer deriving them from one source of truth during snapshot build.

---

## 27. Algorithm Selection Cheat Sheet

| Problem | Structure/Algorithm |
|---|---|
| Validate state/action transition | `EnumMap<State, EnumMap<Action, Transition>>` |
| List allowed actions | adjacency lookup + permission + guard filter |
| Check role permission | `EnumMap<Role, EnumMap<State, EnumSet<Action>>>` |
| Find unreachable state | BFS/DFS |
| Detect accidental cycle | DFS color / SCC |
| Process earliest escalation | `PriorityQueue` |
| Query deadline range | `NavigableMap<Instant, List<Task>>` |
| Resolve effective policy | `NavigableMap.floorEntry` |
| Find impacted entities | graph BFS/DFS |
| Group duplicate/linked entities | DSU |
| Store workflow versions | immutable snapshot map |
| Publish new workflow | `AtomicReference<WorkflowSnapshot>` |
| Prevent duplicate command | idempotency key index |
| Prevent lost update | optimistic locking |
| Reconstruct current state | event replay / latest state index |

---

## 28. Mental Model: Workflow Engine as Composite Data Structure

A robust workflow engine is not one algorithm. It is a composition:

```text
Workflow Engine =
  Transition Graph
+ Permission Matrix
+ Guard Evaluator
+ Effect Dispatcher
+ Audit Log
+ Versioned Snapshot
+ Escalation Queue
+ Deadline Index
+ Dependency Graph
+ Idempotency Index
+ Optimistic Lock Boundary
```

Each component has a different DSA shape:

| Component | DSA Shape |
|---|---|
| Transition graph | adjacency map |
| Permission matrix | enum map + enum set |
| Guard list | ordered list/pipeline |
| Effect dispatch | queue/outbox |
| Audit log | append-only sequence + indexes |
| Workflow version | immutable snapshot |
| Escalation | heap/sorted map |
| Dependency | directed graph |
| Idempotency | hash index |
| Effective policy | navigable map |

This is the top-tier mindset:

> Do not ask “which algorithm should I use?” in isolation. Ask “what are the operations, invariants, query patterns, mutation patterns, and failure modes?”

---

## 29. Practical Design Checklist

Before implementing a workflow/state machine, answer these:

### State and Transition

1. What are all states?
2. Which state is initial?
3. Which states are terminal?
4. Which transitions are allowed?
5. Is workflow deterministic?
6. Can the same action from same state have multiple outcomes?
7. Are cycles allowed?
8. Are terminal states absorbing?

### Guard and Permission

1. Which roles can perform each transition?
2. Which guards are local?
3. Which guards require external call?
4. Are guards read-only?
5. Should guard failures be accumulated?
6. Which failures are retryable?

### Effects and Audit

1. What effects happen after transition?
2. Which effects must be transactional?
3. Which effects should use outbox?
4. What audit evidence is required?
5. Does audit store workflow version?
6. Is reason mandatory for some actions?

### Concurrency and Idempotency

1. Is optimistic lock required?
2. Is idempotency key required?
3. What happens on duplicate command?
4. What happens on stale state?
5. Are background jobs racing with user actions?

### Indexing and Query

1. Need lookup by ID?
2. Need query by state?
3. Need query by deadline?
4. Need query by actor?
5. Need effective-date resolution?
6. Need impact analysis?

### Evolution

1. How is workflow versioned?
2. Are existing cases migrated?
3. How is migration audited?
4. Can old workflow still be replayed?
5. Can definition be validated before deployment?

---

## 30. Summary

Pada bagian ini kita melihat bahwa workflow dan state machine adalah salah satu tempat DSA paling berguna dalam software engineering nyata.

Key takeaways:

1. State machine adalah directed graph.
2. Transition table lebih auditable daripada `if-else` tersebar.
3. Guard, permission, effect, policy, dan audit harus dipisahkan.
4. `EnumMap` dan `EnumSet` sangat cocok untuk enum-based workflow matrix.
5. Reachability, dead-end, dan cycle validation memakai graph traversal.
6. Escalation adalah priority/sorted-index problem.
7. Effective-date policy adalah `NavigableMap` problem.
8. Dependency impact adalah graph traversal problem.
9. Workflow definition sebaiknya immutable dan versioned.
10. Idempotency dan optimistic locking adalah bagian dari correctness, bukan detail infrastruktur.
11. Audit trail adalah append-only structure dengan query-driven indexes.
12. State explosion harus dihindari dengan memisahkan lifecycle state dari independent dimensions.

Mental model final:

```text
A production workflow engine is a graph-backed, versioned, auditable, query-indexed state transition system.
```

Kalau kamu bisa mendesain workflow seperti itu, kamu tidak hanya “menggunakan DSA”, tetapi menggunakan DSA sebagai fondasi correctness, auditability, evolvability, dan production reliability.

---

## 31. Referensi

- Oracle Java SE 25 API — `EnumMap`
- Oracle Java SE 24/25 API — `EnumSet`
- Oracle Java SE 25 API — `NavigableMap`
- Oracle Java SE 25 API — `PriorityQueue`
- Oracle Java SE 25 API — `Map`
- Oracle Java SE 25 API — `ArrayDeque`
- Oracle Java SE 25 API — `java.util.concurrent.atomic.AtomicReference`
- OpenJDK / Java Collections Framework documentation

---

## 32. Status Seri

Part ini adalah **Part 027 dari 030**.

Seri **belum selesai**.

Berikutnya:

```text
Part 028 — Performance Engineering: Benchmarking DSA in Java
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-dsa-part-026.md">⬅️ Part 026 — Persistent, Immutable, Copy-on-Write, and Snapshot Structures</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-dsa-part-028.md">Learn Java DSA — Part 028 ➡️</a>
</div>
