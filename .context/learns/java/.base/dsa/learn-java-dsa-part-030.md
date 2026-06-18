# learn-java-dsa-part-030 — Capstone: Designing a Production-Grade Rule, Workflow, and Case Indexing Engine

> Seri: Java Data Structure and Algorithm Advanced  
> Part: 030 dari 030  
> Status: Bagian terakhir / capstone  
> Fokus: menyatukan struktur data, algoritma, invariants, complexity, performance, failure modelling, dan desain Java production-grade.

---

## 0. Tujuan Bagian Ini

Bagian ini adalah capstone dari seluruh seri Java Data Structure and Algorithm.

Kita tidak lagi membahas satu struktur data secara terpisah. Kita akan merancang sebuah engine kecil yang realistis, mirip komponen yang mungkin muncul di sistem case management, enforcement lifecycle, workflow approval, rule evaluation, SLA monitoring, atau regulatory platform.

Target akhirnya adalah membangun mental model seperti ini:

> Struktur data bukan dipilih karena populer, tetapi karena cocok dengan operasi, invariant, workload, mutation pattern, memory budget, concurrency model, dan failure mode domain.

Kita akan mendesain:

```text
Production-Grade Rule, Workflow, and Case Indexing Engine
```

Engine ini akan mendukung:

1. lookup case by ID,
2. query case by state,
3. query case by deadline range,
4. transition validation,
5. guard/rule evaluation,
6. escalation priority queue,
7. dependency impact analysis,
8. duplicate/entity clustering,
9. audit retrieval,
10. immutable workflow snapshot,
11. safe update strategy,
12. complexity analysis,
13. failure model,
14. benchmark plan,
15. testing strategy.

---

## 1. Problem Statement

Bayangkan kita memiliki sistem regulatory case management.

Setiap case memiliki:

- `caseId`,
- `caseType`,
- current `state`,
- parties,
- documents,
- assigned officer,
- deadlines,
- severity,
- transitions,
- audit trail,
- dependencies to other cases/entities,
- rules that determine allowed actions.

Sistem harus bisa menjawab pertanyaan berikut dengan cepat dan benar:

1. “Case dengan ID ini ada tidak?”
2. “Case apa saja yang sedang berada di state `UNDER_REVIEW`?”
3. “Case mana yang deadline-nya jatuh sebelum tanggal X?”
4. “Apakah case ini boleh transition dari `SUBMITTED` ke `UNDER_REVIEW`?”
5. “Rule mana yang harus dievaluasi untuk transition ini?”
6. “Case mana yang harus diescalate paling dahulu?”
7. “Kalau entity A berubah, case mana saja yang terdampak?”
8. “Apakah dua parties ini sebenarnya duplicate cluster?”
9. “Audit trail terbaru untuk case ini apa?”
10. “Bisakah config workflow diganti tanpa merusak request yang sedang berjalan?”

Jika kita memakai pendekatan naive, kita mungkin akan menyimpan semua case dalam satu `List<CaseRecord>` lalu melakukan scan terus-menerus.

Contoh buruk:

```java
List<CaseRecord> cases = loadAllCases();

List<CaseRecord> findByState(CaseState state) {
    return cases.stream()
        .filter(c -> c.state() == state)
        .toList();
}
```

Untuk data kecil ini tidak masalah. Tetapi untuk ratusan ribu atau jutaan case, ini menjadi masalah:

- setiap query `O(n)`,
- banyak allocation dari stream pipeline dan result list,
- tidak ada invariant indexing,
- sulit menjaga consistency antar view,
- sulit mendeteksi stale index,
- sulit mendesain concurrency boundary.

Capstone ini akan membangun solusi yang lebih matang.

---

## 2. Core Domain Model

Kita mulai dari model kecil.

```java
import java.time.Instant;
import java.util.Set;

public record CaseRecord(
        CaseId id,
        CaseType type,
        CaseState state,
        Severity severity,
        Instant createdAt,
        Instant updatedAt,
        Instant deadlineAt,
        Set<PartyId> parties,
        Set<DocumentId> documents,
        Set<CaseId> dependsOn
) {}

public record CaseId(String value) {}
public record PartyId(String value) {}
public record DocumentId(String value) {}

public enum CaseType {
    APPLICATION,
    RENEWAL,
    APPEAL,
    INVESTIGATION,
    ENFORCEMENT
}

public enum CaseState {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    WAITING_FOR_INFORMATION,
    APPROVED,
    REJECTED,
    ESCALATED,
    CLOSED,
    CANCELLED
}

public enum Severity {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}
```

### Kenapa memakai record?

Karena untuk capstone ini kita ingin `CaseRecord` bersifat value-like dan mudah dibuat immutable.

Namun harus hati-hati:

```java
Set<PartyId> parties
Set<DocumentId> documents
Set<CaseId> dependsOn
```

Walaupun `record` field-nya final, isi collection masih bisa mutable jika kita tidak melakukan defensive copy.

Versi lebih aman:

```java
public record CaseRecord(
        CaseId id,
        CaseType type,
        CaseState state,
        Severity severity,
        Instant createdAt,
        Instant updatedAt,
        Instant deadlineAt,
        Set<PartyId> parties,
        Set<DocumentId> documents,
        Set<CaseId> dependsOn
) {
    public CaseRecord {
        if (id == null) throw new IllegalArgumentException("id is required");
        if (type == null) throw new IllegalArgumentException("type is required");
        if (state == null) throw new IllegalArgumentException("state is required");
        if (severity == null) throw new IllegalArgumentException("severity is required");
        if (createdAt == null) throw new IllegalArgumentException("createdAt is required");
        if (updatedAt == null) throw new IllegalArgumentException("updatedAt is required");
        if (deadlineAt == null) throw new IllegalArgumentException("deadlineAt is required");

        parties = Set.copyOf(parties == null ? Set.of() : parties);
        documents = Set.copyOf(documents == null ? Set.of() : documents);
        dependsOn = Set.copyOf(dependsOn == null ? Set.of() : dependsOn);
    }
}
```

### Invariant awal

Untuk setiap `CaseRecord`:

1. `id` tidak null.
2. `state` tidak null.
3. `deadlineAt` tidak null.
4. collection field tidak null.
5. collection field tidak externally mutable.
6. `updatedAt >= createdAt`.
7. terminal state tidak boleh memiliki deadline aktif baru kecuali domain memang mengizinkan.

Tambahan:

```java
if (updatedAt.isBefore(createdAt)) {
    throw new IllegalArgumentException("updatedAt must not be before createdAt");
}
```

---

## 3. Required Operations dan Struktur Data yang Cocok

Kita buat tabel kebutuhan.

| Operation | Target | Struktur Data Kandidat |
|---|---:|---|
| Lookup by case ID | `O(1)` average | `HashMap<CaseId, CaseRecord>` |
| Query by state | `O(1)` to state bucket + iterate result | `EnumMap<CaseState, Set<CaseId>>` |
| Query by type | `O(1)` to type bucket | `EnumMap<CaseType, Set<CaseId>>` |
| Query by deadline range | `O(log n + k)` | `NavigableMap<Instant, Set<CaseId>>` |
| Escalation priority | `O(log n)` insert/pop | `PriorityQueue<EscalationItem>` |
| Workflow transition validation | `O(1)`/small set lookup | `EnumMap<CaseState, EnumSet<CaseState>>` |
| Guard/rule lookup | `O(1)` by transition key | `Map<TransitionKey, List<Rule>>` |
| Dependency impact | `O(V + E)` traversal | adjacency map graph |
| Duplicate clusters | near-constant amortized | DSU / Union-Find |
| Permission/state flags | compact set | `EnumSet`, `BitSet` |
| Immutable config snapshot | safe read sharing | copy-on-write snapshot object |

Kita tidak memakai satu struktur data besar. Kita memakai beberapa index yang masing-masing melayani query berbeda.

Ini prinsip penting:

> Production data structure design sering berarti memelihara beberapa derived indexes dari source of truth yang sama.

Tetapi begitu kita punya multiple index, masalah utama berubah:

> Bagaimana menjaga semua index tetap konsisten saat insert/update/delete?

---

## 4. Source of Truth vs Derived Index

Kita definisikan:

```text
Primary store:
  byId: Map<CaseId, CaseRecord>

Derived indexes:
  byState: EnumMap<CaseState, Set<CaseId>>
  byType: EnumMap<CaseType, Set<CaseId>>
  byDeadline: NavigableMap<Instant, Set<CaseId>>
  byParty: Map<PartyId, Set<CaseId>>
  dependencyGraph: Map<CaseId, Set<CaseId>>
```

Primary store menyimpan object lengkap.
Derived index hanya menyimpan ID.

Kenapa index menyimpan ID, bukan `CaseRecord`?

Karena jika index menyimpan object penuh:

1. duplicate references meningkat,
2. risk stale object lebih besar,
3. update harus mengganti object di banyak tempat,
4. equality dan identity bisa membingungkan,
5. memory retention lebih sulit dilacak.

Dengan ID-only index:

- index lebih ringan,
- source of truth jelas,
- retrieval final tetap dari `byId`,
- index consistency lebih mudah divalidasi.

---

## 5. CaseIndex: Desain Struktur Internal

Kita mulai dari versi single-threaded mutable index.

```java
import java.time.Instant;
import java.util.*;

public final class CaseIndex {
    private final Map<CaseId, CaseRecord> byId = new HashMap<>();
    private final EnumMap<CaseState, Set<CaseId>> byState = new EnumMap<>(CaseState.class);
    private final EnumMap<CaseType, Set<CaseId>> byType = new EnumMap<>(CaseType.class);
    private final NavigableMap<Instant, Set<CaseId>> byDeadline = new TreeMap<>();
    private final Map<PartyId, Set<CaseId>> byParty = new HashMap<>();
    private final Map<CaseId, Set<CaseId>> dependentsByCase = new HashMap<>();

    public CaseIndex() {
        for (CaseState state : CaseState.values()) {
            byState.put(state, new HashSet<>());
        }
        for (CaseType type : CaseType.values()) {
            byType.put(type, new HashSet<>());
        }
    }

    public Optional<CaseRecord> findById(CaseId id) {
        return Optional.ofNullable(byId.get(id));
    }

    public List<CaseRecord> findByState(CaseState state) {
        Set<CaseId> ids = byState.getOrDefault(state, Set.of());
        return materialize(ids);
    }

    public List<CaseRecord> findDeadlineBefore(Instant deadlineExclusive) {
        NavigableMap<Instant, Set<CaseId>> range = byDeadline.headMap(deadlineExclusive, false);
        List<CaseRecord> result = new ArrayList<>();
        for (Set<CaseId> ids : range.values()) {
            for (CaseId id : ids) {
                CaseRecord record = byId.get(id);
                if (record != null) {
                    result.add(record);
                }
            }
        }
        return result;
    }

    private List<CaseRecord> materialize(Collection<CaseId> ids) {
        List<CaseRecord> result = new ArrayList<>(ids.size());
        for (CaseId id : ids) {
            CaseRecord record = byId.get(id);
            if (record != null) {
                result.add(record);
            }
        }
        return result;
    }
}
```

Ini belum lengkap, tetapi sudah menunjukkan pola:

- `HashMap` untuk direct lookup,
- `EnumMap` untuk enum key,
- `TreeMap`/`NavigableMap` untuk range query,
- `HashMap<PartyId, Set<CaseId>>` untuk reverse index,
- graph adjacency untuk dependency traversal.

---

## 6. Insert Operation: Semua Index Harus Update Bersama

Kita tambahkan `put`.

```java
public void put(CaseRecord record) {
    Objects.requireNonNull(record, "record");

    CaseRecord existing = byId.get(record.id());
    if (existing != null) {
        removeFromIndexes(existing);
    }

    byId.put(record.id(), record);
    addToIndexes(record);
}

private void addToIndexes(CaseRecord record) {
    byState.get(record.state()).add(record.id());
    byType.get(record.type()).add(record.id());

    byDeadline
        .computeIfAbsent(record.deadlineAt(), ignored -> new HashSet<>())
        .add(record.id());

    for (PartyId partyId : record.parties()) {
        byParty
            .computeIfAbsent(partyId, ignored -> new HashSet<>())
            .add(record.id());
    }

    for (CaseId dependency : record.dependsOn()) {
        dependentsByCase
            .computeIfAbsent(dependency, ignored -> new HashSet<>())
            .add(record.id());
    }
}

private void removeFromIndexes(CaseRecord record) {
    byState.get(record.state()).remove(record.id());
    byType.get(record.type()).remove(record.id());

    removeFromMultiMap(byDeadline, record.deadlineAt(), record.id());

    for (PartyId partyId : record.parties()) {
        removeFromMultiMap(byParty, partyId, record.id());
    }

    for (CaseId dependency : record.dependsOn()) {
        removeFromMultiMap(dependentsByCase, dependency, record.id());
    }
}

private static <K, V> void removeFromMultiMap(Map<K, Set<V>> map, K key, V value) {
    Set<V> values = map.get(key);
    if (values == null) {
        return;
    }
    values.remove(value);
    if (values.isEmpty()) {
        map.remove(key);
    }
}
```

### Invariant multi-index

Setelah `put(record)`:

1. `byId.get(record.id()) == record` secara logical.
2. `byState.get(record.state()).contains(record.id())`.
3. `byType.get(record.type()).contains(record.id())`.
4. `byDeadline.get(record.deadlineAt()).contains(record.id())`.
5. Untuk setiap party, `byParty.get(party).contains(record.id())`.
6. Untuk setiap dependency, `dependentsByCase.get(dependency).contains(record.id())`.
7. Record lama dengan ID sama tidak boleh tersisa di index lama.

Poin ke-7 sangat penting.

Bug umum:

```java
byId.put(record.id(), record);
addToIndexes(record);
```

Tanpa remove old index, case akan muncul di state lama dan state baru sekaligus.

---

## 7. Update State: Jangan Treat sebagai Mutasi In-Place

Jika `CaseRecord` immutable, update state berarti membuat record baru.

```java
public void transitionState(CaseId id, CaseState nextState, Instant now) {
    CaseRecord current = byId.get(id);
    if (current == null) {
        throw new NoSuchElementException("case not found: " + id.value());
    }

    CaseRecord updated = new CaseRecord(
            current.id(),
            current.type(),
            nextState,
            current.severity(),
            current.createdAt(),
            now,
            current.deadlineAt(),
            current.parties(),
            current.documents(),
            current.dependsOn()
    );

    put(updated);
}
```

Ini tampak lebih mahal daripada mutable object.

Tetapi benefit-nya besar:

1. Tidak ada object yang diam-diam berubah saat masih dipakai reader lain.
2. Index update eksplisit.
3. Audit event bisa menyimpan old/new state.
4. Snapshot consistency lebih mudah.
5. Testing invariant lebih jelas.

Di Java production system, immutable record + explicit replacement sering lebih aman daripada mutable object yang dipegang banyak index.

---

## 8. Workflow Definition sebagai Graph

Workflow state transition bisa dimodelkan sebagai directed graph.

Contoh:

```text
DRAFT -> SUBMITTED
SUBMITTED -> UNDER_REVIEW
UNDER_REVIEW -> WAITING_FOR_INFORMATION
WAITING_FOR_INFORMATION -> UNDER_REVIEW
UNDER_REVIEW -> APPROVED
UNDER_REVIEW -> REJECTED
UNDER_REVIEW -> ESCALATED
ESCALATED -> CLOSED
APPROVED -> CLOSED
REJECTED -> CLOSED
```

Representasi Java:

```java
import java.util.*;

public final class WorkflowDefinition {
    private final EnumMap<CaseState, EnumSet<CaseState>> allowedTransitions;

    public WorkflowDefinition(Map<CaseState, ? extends Set<CaseState>> transitions) {
        EnumMap<CaseState, EnumSet<CaseState>> copy = new EnumMap<>(CaseState.class);

        for (CaseState state : CaseState.values()) {
            Set<CaseState> next = transitions.getOrDefault(state, Set.of());
            copy.put(state, next.isEmpty()
                    ? EnumSet.noneOf(CaseState.class)
                    : EnumSet.copyOf(next));
        }

        this.allowedTransitions = copy;
        validateTerminalStates();
    }

    public boolean canTransition(CaseState from, CaseState to) {
        return allowedTransitions.getOrDefault(from, EnumSet.noneOf(CaseState.class)).contains(to);
    }

    public Set<CaseState> nextStates(CaseState from) {
        return Set.copyOf(allowedTransitions.getOrDefault(from, EnumSet.noneOf(CaseState.class)));
    }

    private void validateTerminalStates() {
        // Example domain policy: CLOSED and CANCELLED are terminal.
        if (!allowedTransitions.get(CaseState.CLOSED).isEmpty()) {
            throw new IllegalArgumentException("CLOSED must be terminal");
        }
        if (!allowedTransitions.get(CaseState.CANCELLED).isEmpty()) {
            throw new IllegalArgumentException("CANCELLED must be terminal");
        }
    }
}
```

Kenapa `EnumMap` + `EnumSet`?

- key adalah enum,
- jumlah state kecil,
- lookup cepat,
- memory compact,
- intent jelas,
- tidak perlu hash general-purpose.

Ini contoh pemilihan struktur data berdasarkan domain.

---

## 9. Transition Validation

Transition bukan hanya edge graph. Biasanya ada guard/rule.

Contoh:

```text
UNDER_REVIEW -> APPROVED
  allowed only if:
    - all mandatory documents are verified
    - no blocking dependency exists
    - officer has approval permission
    - case is not past regulatory hold
```

Kita definisikan rule interface.

```java
public interface TransitionRule {
    RuleResult evaluate(TransitionContext context);
}

public record RuleResult(
        boolean passed,
        String code,
        String message
) {
    public static RuleResult pass(String code) {
        return new RuleResult(true, code, "passed");
    }

    public static RuleResult fail(String code, String message) {
        return new RuleResult(false, code, message);
    }
}

public record TransitionContext(
        CaseRecord current,
        CaseState targetState,
        WorkflowSnapshot snapshot,
        UserContext user
) {}

public record UserContext(
        String userId,
        Set<String> permissions
) {
    public UserContext {
        permissions = Set.copyOf(permissions == null ? Set.of() : permissions);
    }
}
```

Rules dapat di-index berdasarkan transition.

```java
public record TransitionKey(CaseState from, CaseState to) {}
```

```java
public final class RuleRegistry {
    private final Map<TransitionKey, List<TransitionRule>> rulesByTransition;

    public RuleRegistry(Map<TransitionKey, List<TransitionRule>> rulesByTransition) {
        Map<TransitionKey, List<TransitionRule>> copy = new HashMap<>();
        for (Map.Entry<TransitionKey, List<TransitionRule>> entry : rulesByTransition.entrySet()) {
            copy.put(entry.getKey(), List.copyOf(entry.getValue()));
        }
        this.rulesByTransition = Map.copyOf(copy);
    }

    public List<TransitionRule> rulesFor(CaseState from, CaseState to) {
        return rulesByTransition.getOrDefault(new TransitionKey(from, to), List.of());
    }
}
```

### Kenapa `List` untuk rules?

Karena order rule sering bermakna:

1. cheap validation dulu,
2. expensive validation belakangan,
3. hard-blocking rule sebelum advisory rule,
4. deterministic error reporting.

Jika order tidak penting, `Set` bisa dipakai. Tetapi di rule engine, order sering penting.

---

## 10. Transition Engine

```java
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

public final class TransitionEngine {
    private final CaseIndex index;
    private final WorkflowSnapshotProvider snapshotProvider;

    public TransitionEngine(CaseIndex index, WorkflowSnapshotProvider snapshotProvider) {
        this.index = index;
        this.snapshotProvider = snapshotProvider;
    }

    public TransitionDecision validate(CaseId caseId, CaseState targetState, UserContext user) {
        CaseRecord current = index.findById(caseId)
                .orElseThrow(() -> new NoSuchElementException("case not found: " + caseId.value()));

        WorkflowSnapshot snapshot = snapshotProvider.current();

        if (!snapshot.workflow().canTransition(current.state(), targetState)) {
            return TransitionDecision.rejected(List.of(
                    RuleResult.fail("TRANSITION_NOT_ALLOWED",
                            "Transition from " + current.state() + " to " + targetState + " is not allowed")
            ));
        }

        TransitionContext context = new TransitionContext(current, targetState, snapshot, user);
        List<RuleResult> results = new ArrayList<>();

        for (TransitionRule rule : snapshot.ruleRegistry().rulesFor(current.state(), targetState)) {
            RuleResult result = rule.evaluate(context);
            results.add(result);
            if (!result.passed()) {
                // Fail-fast policy. Alternative: collect all failures.
                return TransitionDecision.rejected(results);
            }
        }

        return TransitionDecision.approved(results);
    }

    public TransitionDecision transition(CaseId caseId, CaseState targetState, UserContext user, Instant now) {
        TransitionDecision decision = validate(caseId, targetState, user);
        if (!decision.approved()) {
            return decision;
        }
        index.transitionState(caseId, targetState, now);
        return decision;
    }
}

public record TransitionDecision(
        boolean approved,
        List<RuleResult> results
) {
    public TransitionDecision {
        results = List.copyOf(results == null ? List.of() : results);
    }

    public static TransitionDecision approved(List<RuleResult> results) {
        return new TransitionDecision(true, results);
    }

    public static TransitionDecision rejected(List<RuleResult> results) {
        return new TransitionDecision(false, results);
    }
}
```

### Complexity

Jika:

- transition graph lookup `O(1)`,
- rules for transition = `r`,
- each rule cost varies,

maka validation cost:

```text
O(1 + r * rule_cost)
```

Dalam production, `rule_cost` lebih penting daripada `r`.

Rule yang melakukan DB/API call jauh lebih mahal daripada rule yang membaca in-memory index.

---

## 11. Workflow Snapshot: Immutable Config untuk Safe Sharing

Workflow dan rule registry sebaiknya dibaca sangat sering, tetapi diubah jarang.

Pattern yang cocok:

```text
immutable snapshot + atomic replacement
```

```java
public record WorkflowSnapshot(
        long version,
        WorkflowDefinition workflow,
        RuleRegistry ruleRegistry
) {}

public interface WorkflowSnapshotProvider {
    WorkflowSnapshot current();
}
```

```java
import java.util.concurrent.atomic.AtomicReference;

public final class AtomicWorkflowSnapshotProvider implements WorkflowSnapshotProvider {
    private final AtomicReference<WorkflowSnapshot> current;

    public AtomicWorkflowSnapshotProvider(WorkflowSnapshot initial) {
        this.current = new AtomicReference<>(Objects.requireNonNull(initial));
    }

    @Override
    public WorkflowSnapshot current() {
        return current.get();
    }

    public void replace(WorkflowSnapshot next) {
        current.set(Objects.requireNonNull(next));
    }
}
```

### Kenapa bukan update map in-place?

Karena update in-place bisa membuat reader melihat config setengah berubah.

Contoh buruk:

```java
allowedTransitions.clear();
allowedTransitions.putAll(newTransitions);
```

Jika ada request membaca di tengah proses, ia bisa melihat workflow kosong atau setengah lengkap.

Snapshot replacement membuat reader melihat:

- snapshot lama yang lengkap, atau
- snapshot baru yang lengkap.

Tidak ada intermediate partial state.

---

## 12. Deadline Index dengan NavigableMap

Deadline query biasanya butuh:

1. before X,
2. between A and B,
3. next due item,
4. overdue items,
5. bucket per exact timestamp.

`NavigableMap<Instant, Set<CaseId>>` cocok untuk range query.

```java
public List<CaseRecord> findDeadlineBetween(Instant fromInclusive, Instant toExclusive) {
    NavigableMap<Instant, Set<CaseId>> range =
            byDeadline.subMap(fromInclusive, true, toExclusive, false);

    List<CaseRecord> result = new ArrayList<>();
    for (Set<CaseId> ids : range.values()) {
        for (CaseId id : ids) {
            CaseRecord record = byId.get(id);
            if (record != null) {
                result.add(record);
            }
        }
    }
    return result;
}
```

Complexity:

```text
O(log d + b + k)
```

Where:

- `d` = number of distinct deadline timestamps,
- `b` = number of deadline buckets in range,
- `k` = number of case IDs materialized.

Jika banyak case punya timestamp berbeda sampai nanosecond, bucket terlalu banyak. Dalam workload tertentu, lebih baik bucket deadline ke minute/hour/day.

Contoh bucket harian:

```java
import java.time.LocalDate;
import java.time.ZoneId;

public static LocalDate deadlineBucket(Instant instant, ZoneId zoneId) {
    return instant.atZone(zoneId).toLocalDate();
}
```

Lalu index:

```java
NavigableMap<LocalDate, Set<CaseId>> byDeadlineDate = new TreeMap<>();
```

Trade-off:

| Granularity | Pros | Cons |
|---|---|---|
| Instant exact | precise | many buckets |
| minute | lower bucket count | needs filtering inside bucket |
| hour | good for dashboard | less precise |
| date | simple SLA report | not suitable for exact scheduler |

---

## 13. Escalation Priority Queue

Escalation sering butuh prioritas gabungan:

1. severity,
2. deadline,
3. age,
4. case type,
5. regulatory priority.

Kita buat item:

```java
public record EscalationItem(
        CaseId caseId,
        Severity severity,
        Instant deadlineAt,
        Instant insertedAt,
        long version
) {}
```

Comparator:

```java
import java.util.Comparator;

public final class EscalationOrdering {
    public static final Comparator<EscalationItem> ORDER =
            Comparator
                    .comparing(EscalationItem::severity, EscalationOrdering::severityDesc)
                    .thenComparing(EscalationItem::deadlineAt)
                    .thenComparing(EscalationItem::insertedAt)
                    .thenComparing(item -> item.caseId().value());

    private static int severityDesc(Severity left, Severity right) {
        return Integer.compare(rank(right), rank(left));
    }

    private static int rank(Severity severity) {
        return switch (severity) {
            case LOW -> 1;
            case MEDIUM -> 2;
            case HIGH -> 3;
            case CRITICAL -> 4;
        };
    }
}
```

Kenapa `caseId` menjadi tie-breaker terakhir?

Agar ordering deterministic.

Tanpa tie-breaker deterministic, dua item yang sama severity/deadline/insertedAt bisa memiliki urutan yang tidak stabil antar run. Untuk beberapa sistem, ini tidak masalah. Untuk audit-sensitive system, deterministic ordering bisa membantu debugging dan reproducibility.

Priority queue:

```java
import java.util.PriorityQueue;

public final class EscalationQueue {
    private final PriorityQueue<EscalationItem> queue = new PriorityQueue<>(EscalationOrdering.ORDER);
    private final Map<CaseId, Long> latestVersionByCase = new HashMap<>();

    public void offer(EscalationItem item) {
        latestVersionByCase.put(item.caseId(), item.version());
        queue.offer(item);
    }

    public Optional<EscalationItem> pollValid() {
        while (!queue.isEmpty()) {
            EscalationItem item = queue.poll();
            Long latestVersion = latestVersionByCase.get(item.caseId());
            if (latestVersion != null && latestVersion == item.version()) {
                latestVersionByCase.remove(item.caseId());
                return Optional.of(item);
            }
        }
        return Optional.empty();
    }
}
```

### Lazy deletion

Java `PriorityQueue` tidak menyediakan efficient priority update.

Jika priority berubah, strategi umum:

1. masukkan item baru dengan version lebih baru,
2. biarkan item lama tetap di heap,
3. saat poll, buang item stale.

Cost:

- insert `O(log n)`,
- poll bisa membuang beberapa stale item,
- butuh cleanup strategy jika stale item menumpuk.

Failure mode:

Jika update sangat sering dan poll jarang, heap bisa membesar karena stale items.

Mitigasi:

1. periodic rebuild,
2. cap queue size,
3. monitor stale ratio,
4. use indexed heap custom jika priority update sangat penting.

---

## 14. Dependency Impact Graph

Jika case A berubah, case B/C/D mungkin terdampak.

Kita butuh reverse dependency graph:

```text
A <- B
A <- C
B <- D
```

Artinya:

- B depends on A,
- C depends on A,
- D depends on B.

Jika A berubah, impacted = B, C, D.

Representasi:

```java
Map<CaseId, Set<CaseId>> dependentsByCase;
```

Traversal BFS:

```java
public Set<CaseId> findImpactedCases(CaseId changedCaseId) {
    Set<CaseId> impacted = new LinkedHashSet<>();
    ArrayDeque<CaseId> queue = new ArrayDeque<>();

    queue.add(changedCaseId);

    while (!queue.isEmpty()) {
        CaseId current = queue.removeFirst();
        for (CaseId dependent : dependentsByCase.getOrDefault(current, Set.of())) {
            if (impacted.add(dependent)) {
                queue.addLast(dependent);
            }
        }
    }

    impacted.remove(changedCaseId);
    return impacted;
}
```

Kenapa `LinkedHashSet`?

Agar traversal order deterministic berdasarkan insertion/traversal order. Ini berguna untuk testing dan debugging.

### Cycle handling

Jika dependency graph seharusnya DAG, cycle harus dideteksi.

Namun traversal tetap harus aman walaupun data corrupt.

`impacted.add(dependent)` berfungsi sebagai visited check.

Tanpa visited, cycle akan membuat infinite loop.

---

## 15. Cycle Detection untuk Dependency Graph

Jika domain melarang cyclic dependency, validasi DAG wajib.

```java
public final class GraphCycleDetector {
    enum Color { WHITE, GRAY, BLACK }

    public static <T> Optional<List<T>> findCycle(Map<T, ? extends Set<T>> graph) {
        Map<T, Color> color = new HashMap<>();
        Map<T, T> parent = new HashMap<>();

        for (T node : graph.keySet()) {
            color.putIfAbsent(node, Color.WHITE);
            for (T next : graph.getOrDefault(node, Set.of())) {
                color.putIfAbsent(next, Color.WHITE);
            }
        }

        for (T node : color.keySet()) {
            if (color.get(node) == Color.WHITE) {
                Optional<List<T>> cycle = dfs(node, graph, color, parent);
                if (cycle.isPresent()) {
                    return cycle;
                }
            }
        }

        return Optional.empty();
    }

    private static <T> Optional<List<T>> dfs(
            T node,
            Map<T, ? extends Set<T>> graph,
            Map<T, Color> color,
            Map<T, T> parent
    ) {
        color.put(node, Color.GRAY);

        for (T next : graph.getOrDefault(node, Set.of())) {
            Color nextColor = color.getOrDefault(next, Color.WHITE);

            if (nextColor == Color.GRAY) {
                return Optional.of(reconstructCycle(node, next, parent));
            }

            if (nextColor == Color.WHITE) {
                parent.put(next, node);
                Optional<List<T>> cycle = dfs(next, graph, color, parent);
                if (cycle.isPresent()) {
                    return cycle;
                }
            }
        }

        color.put(node, Color.BLACK);
        return Optional.empty();
    }

    private static <T> List<T> reconstructCycle(T from, T to, Map<T, T> parent) {
        LinkedList<T> cycle = new LinkedList<>();
        cycle.addFirst(to);
        T current = from;
        while (!Objects.equals(current, to)) {
            cycle.addFirst(current);
            current = parent.get(current);
            if (current == null) {
                break;
            }
        }
        cycle.addLast(to);
        return cycle;
    }
}
```

Caveat:

Recursive DFS bisa stack overflow untuk graph sangat dalam. Untuk production dengan data tidak terpercaya, iterative algorithm lebih aman.

---

## 16. Duplicate Entity Clustering dengan DSU

Misalnya kita memiliki party duplicate detection.

```text
Party P1 same as P2
Party P2 same as P3
```

Maka P1, P2, P3 berada dalam cluster yang sama.

Union-Find cocok.

```java
public final class DisjointSet<T> {
    private final Map<T, T> parent = new HashMap<>();
    private final Map<T, Integer> size = new HashMap<>();

    public void add(T item) {
        parent.putIfAbsent(item, item);
        size.putIfAbsent(item, 1);
    }

    public T find(T item) {
        add(item);
        T p = parent.get(item);
        if (!p.equals(item)) {
            T root = find(p);
            parent.put(item, root);
            return root;
        }
        return p;
    }

    public boolean union(T a, T b) {
        T rootA = find(a);
        T rootB = find(b);

        if (rootA.equals(rootB)) {
            return false;
        }

        int sizeA = size.get(rootA);
        int sizeB = size.get(rootB);

        if (sizeA < sizeB) {
            T tmp = rootA;
            rootA = rootB;
            rootB = tmp;
        }

        parent.put(rootB, rootA);
        size.put(rootA, sizeA + sizeB);
        size.remove(rootB);
        return true;
    }

    public Map<T, Set<T>> clusters() {
        Map<T, Set<T>> result = new HashMap<>();
        for (T item : parent.keySet()) {
            T root = find(item);
            result.computeIfAbsent(root, ignored -> new LinkedHashSet<>()).add(item);
        }
        return result;
    }
}
```

Production considerations:

1. DSU in-memory cocok untuk batch/dataset terbatas.
2. Untuk cluster persistent, root ID harus disimpan di DB atau materialized index.
3. Union operation harus transactional jika mempengaruhi data regulatory.
4. Explainability penting: jangan hanya simpan cluster, simpan evidence kenapa dua entity digabung.

---

## 17. Audit Trail Retrieval

Audit trail sering besar dan append-only.

In-memory index sederhana:

```java
public record AuditEvent(
        CaseId caseId,
        long sequence,
        Instant occurredAt,
        String actor,
        String action,
        String summary
) {}
```

Index:

```java
public final class AuditIndex {
    private final Map<CaseId, NavigableMap<Long, AuditEvent>> byCaseSequence = new HashMap<>();

    public void append(AuditEvent event) {
        byCaseSequence
                .computeIfAbsent(event.caseId(), ignored -> new TreeMap<>())
                .put(event.sequence(), event);
    }

    public List<AuditEvent> latest(CaseId caseId, int limit) {
        NavigableMap<Long, AuditEvent> events = byCaseSequence.get(caseId);
        if (events == null || events.isEmpty() || limit <= 0) {
            return List.of();
        }

        List<AuditEvent> result = new ArrayList<>(Math.min(limit, events.size()));
        for (AuditEvent event : events.descendingMap().values()) {
            result.add(event);
            if (result.size() == limit) {
                break;
            }
        }
        return result;
    }
}
```

Untuk production real:

- audit trail biasanya di database/log store,
- in-memory index bisa hanya cache/window,
- sequence harus monotonik per case,
- audit event tidak boleh diubah,
- retrieval harus paginated.

Key invariant:

```text
For a given caseId, sequence must be unique and monotonic.
```

---

## 18. Query API Design

Jangan expose internal collection.

Buruk:

```java
public Map<CaseId, CaseRecord> byId() {
    return byId;
}
```

Ini membocorkan mutation capability.

Lebih aman:

```java
public List<CaseRecord> findByType(CaseType type) {
    return materialize(byType.getOrDefault(type, Set.of()));
}

public int countByState(CaseState state) {
    return byState.getOrDefault(state, Set.of()).size();
}

public Map<CaseState, Integer> stateCounts() {
    EnumMap<CaseState, Integer> result = new EnumMap<>(CaseState.class);
    for (CaseState state : CaseState.values()) {
        result.put(state, byState.getOrDefault(state, Set.of()).size());
    }
    return Map.copyOf(result);
}
```

Note:

`Map.copyOf(result)` menghasilkan unmodifiable map, tetapi tidak mempertahankan `EnumMap` sebagai tipe publik. Jika caller hanya butuh `Map`, ini baik.

Jika performance critical dan dipanggil sangat sering, allocation dari `Map.copyOf` perlu dipertimbangkan. Bisa pakai snapshot cache.

---

## 19. Full Index Validation

Karena kita punya banyak index, kita butuh validator.

```java
public List<String> validateIndexes() {
    List<String> errors = new ArrayList<>();

    for (CaseRecord record : byId.values()) {
        if (!byState.getOrDefault(record.state(), Set.of()).contains(record.id())) {
            errors.add("missing byState index for case " + record.id().value());
        }
        if (!byType.getOrDefault(record.type(), Set.of()).contains(record.id())) {
            errors.add("missing byType index for case " + record.id().value());
        }
        if (!byDeadline.getOrDefault(record.deadlineAt(), Set.of()).contains(record.id())) {
            errors.add("missing byDeadline index for case " + record.id().value());
        }
        for (PartyId partyId : record.parties()) {
            if (!byParty.getOrDefault(partyId, Set.of()).contains(record.id())) {
                errors.add("missing byParty index for case " + record.id().value());
            }
        }
    }

    validateReverseIndex("byState", byState, errors);
    validateReverseIndex("byType", byType, errors);
    validateReverseIndex("byDeadline", byDeadline, errors);
    validateReverseIndex("byParty", byParty, errors);

    return errors;
}

private <K> void validateReverseIndex(String name, Map<K, Set<CaseId>> index, List<String> errors) {
    for (Map.Entry<K, Set<CaseId>> entry : index.entrySet()) {
        for (CaseId id : entry.getValue()) {
            if (!byId.containsKey(id)) {
                errors.add(name + " contains unknown case id " + id.value());
            }
        }
    }
}
```

Validator ini mahal, tetapi berguna untuk:

1. startup validation,
2. test suite,
3. admin diagnostic endpoint,
4. background consistency check,
5. migration verification.

---

## 20. Complexity Table

| Operation | Data Structure | Complexity |
|---|---|---:|
| `findById` | `HashMap` | `O(1)` average |
| `put new case` | multiple indexes | `O(p + d + log D)` |
| `update state` | remove old + add new | `O(p + d + log D)` |
| `findByState` | `EnumMap + Set` | `O(k)` materialization |
| `countByState` | `EnumMap + Set.size` | `O(1)` |
| `deadline before X` | `TreeMap.headMap` | `O(log D + b + k)` |
| `validate transition` | graph + rules | `O(r * rule_cost)` |
| `find impacted cases` | BFS/DFS | `O(V + E)` reachable subgraph |
| `offer escalation` | heap | `O(log n)` |
| `poll escalation` | heap + stale discard | `O(log n + stale)` |
| `union duplicate` | DSU | almost `O(1)` amortized |
| `audit latest N` | `TreeMap.descendingMap` | `O(log a + n)` approximately |

Legend:

- `p` = number of parties in case,
- `d` = number of dependencies in case,
- `D` = number of distinct deadline buckets,
- `k` = result size,
- `b` = number of deadline buckets scanned,
- `r` = number of rules,
- `V/E` = graph vertices/edges reached,
- `a` = number of audit events for a case,
- `n` = requested audit limit.

---

## 21. Memory Model

Memory cost tidak hanya `CaseRecord`.

Ada:

1. primary object,
2. ID wrapper records,
3. hash table buckets,
4. hash nodes,
5. tree nodes,
6. set objects per bucket,
7. reverse index references,
8. priority queue array,
9. stale priority queue entries,
10. graph adjacency sets,
11. audit index nodes.

Jika kita memiliki 1 juta case, menyimpan banyak `HashSet<CaseId>` kecil bisa mahal.

Alternative design:

### Option A: General-purpose object indexes

```text
Map<State, Set<CaseId>>
Map<Instant, Set<CaseId>>
Map<PartyId, Set<CaseId>>
```

Pros:

- mudah dibaca,
- flexible,
- cepat dikembangkan,
- idiomatic Java.

Cons:

- banyak object kecil,
- memory overhead tinggi,
- pointer chasing,
- GC pressure.

### Option B: Dense integer IDs

```text
Map<CaseId, int index>
CaseRecord[] records
int[] stateNext
BitSet stateMembership
```

Pros:

- memory lebih compact,
- locality lebih baik,
- cocok untuk analytic/in-memory engine.

Cons:

- complexity implementasi naik,
- deletion sulit,
- ID reuse problem,
- debugging lebih sulit.

### Option C: Hybrid

- `HashMap<CaseId, CaseRecord>` untuk source of truth,
- `EnumMap<CaseState, LinkedHashSet<CaseId>>` untuk state,
- `NavigableMap<LocalDate, List<CaseId>>` untuk reporting deadline,
- DB index untuk heavy query,
- in-memory cache untuk hot path.

Untuk kebanyakan enterprise backend, hybrid lebih realistis.

---

## 22. Consistency Model

Ada beberapa pilihan.

### 22.1 Single-threaded mutation

Semua mutation terjadi di satu thread/actor.

Pros:

- paling mudah benar,
- tidak butuh lock kompleks,
- index consistency mudah.

Cons:

- throughput write terbatas,
- perlu queue.

### 22.2 Coarse-grained lock

```java
public final class LockedCaseIndex {
    private final Object lock = new Object();
    private final CaseIndex delegate = new CaseIndex();

    public void put(CaseRecord record) {
        synchronized (lock) {
            delegate.put(record);
        }
    }

    public Optional<CaseRecord> findById(CaseId id) {
        synchronized (lock) {
            return delegate.findById(id);
        }
    }
}
```

Pros:

- simple,
- correct jika semua akses lewat lock.

Cons:

- read ikut block,
- materialization panjang menahan lock,
- risk contention.

### 22.3 Read-write lock

Bisa memisahkan read dan write, tetapi harus hati-hati:

- jangan return mutable internal collection,
- jangan melakukan long operation di bawah lock,
- jangan call external service saat lock dipegang.

### 22.4 Immutable snapshot replacement

Untuk read-heavy, write-rare:

```text
Build new full index -> atomic swap reference
```

Pros:

- reads lock-free,
- reader selalu melihat consistent snapshot,
- bagus untuk workflow config/rule registry.

Cons:

- rebuild cost,
- memory double saat rebuild,
- stale snapshot selama request.

### 22.5 Concurrent individual structures

Misalnya `ConcurrentHashMap`, concurrent sets, etc.

Ini tidak otomatis membuat multi-index consistency benar.

Masalahnya:

```text
byId updated, but byState not updated yet
```

Reader bisa melihat state intermediate.

Jadi concurrent collections membantu thread-safety structure-level, tetapi tidak menyelesaikan atomicity multi-index.

---

## 23. Failure Model

### Failure 1: Stale index

Symptom:

- case ada di state lama dan baru,
- count dashboard salah,
- query by state mengembalikan case yang sudah pindah.

Cause:

- update index baru tanpa remove index lama.

Mitigation:

- immutable record replacement,
- centralized `put`,
- index validator,
- property-based test.

---

### Failure 2: Mutable key

Symptom:

- `HashMap.get(key)` gagal padahal object terlihat sama,
- duplicate key muncul,
- cache miss aneh.

Cause:

- field yang dipakai `equals/hashCode` berubah setelah object masuk map.

Mitigation:

- key record immutable,
- no mutable collection inside key,
- avoid entity object as key if mutable.

---

### Failure 3: Comparator inconsistent

Symptom:

- `TreeSet` “menghilangkan” element,
- duplicate tidak masuk,
- range query aneh.

Cause:

- comparator tidak total/transitive/consistent with intended equality.

Mitigation:

- use comparator chain,
- add deterministic tie-breaker,
- property test comparator.

---

### Failure 4: Priority queue stale explosion

Symptom:

- memory naik,
- poll membuang banyak stale item,
- escalation latency naik.

Cause:

- lazy deletion tanpa cleanup.

Mitigation:

- monitor stale ratio,
- rebuild heap when stale > threshold,
- use custom indexed heap if necessary.

---

### Failure 5: Graph cycle in domain that assumes DAG

Symptom:

- infinite traversal,
- stack overflow,
- dependency resolution gagal,
- impact analysis terlalu luas.

Cause:

- no cycle validation.

Mitigation:

- validate DAG on write,
- visited set in traversal,
- cycle error reporting.

---

### Failure 6: Unbounded index growth

Symptom:

- heap memory naik,
- GC pressure,
- latency tail.

Cause:

- old cases never removed/archived,
- audit retained forever in memory,
- cache without eviction.

Mitigation:

- archival policy,
- TTL/size limit,
- index compaction,
- offload historical data to DB/search store.

---

### Failure 7: Query result exposes mutable internals

Symptom:

- external caller corrupts index,
- random inconsistency.

Cause:

- returning internal `Set`/`Map` directly.

Mitigation:

- return copies,
- return unmodifiable views only if backing mutation semantics understood,
- prefer domain query methods.

---

## 24. Testing Strategy

### 24.1 Unit test invariants

Example:

```java
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

class CaseIndexTest {
    @Test
    void updateStateMustRemoveOldStateIndex() {
        CaseIndex index = new CaseIndex();
        CaseId id = new CaseId("C-001");

        CaseRecord submitted = new CaseRecord(
                id,
                CaseType.APPLICATION,
                CaseState.SUBMITTED,
                Severity.MEDIUM,
                Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-01-10T00:00:00Z"),
                Set.of(new PartyId("P-001")),
                Set.of(),
                Set.of()
        );

        CaseRecord review = new CaseRecord(
                id,
                CaseType.APPLICATION,
                CaseState.UNDER_REVIEW,
                Severity.MEDIUM,
                submitted.createdAt(),
                Instant.parse("2026-01-02T00:00:00Z"),
                submitted.deadlineAt(),
                submitted.parties(),
                submitted.documents(),
                submitted.dependsOn()
        );

        index.put(submitted);
        index.put(review);

        assertTrue(index.findByState(CaseState.SUBMITTED).isEmpty());
        assertEquals(1, index.findByState(CaseState.UNDER_REVIEW).size());
        assertTrue(index.validateIndexes().isEmpty());
    }
}
```

### 24.2 Property-style tests

Generate random operations:

1. insert case,
2. update state,
3. update deadline,
4. add/remove party,
5. delete case,
6. validate index after each operation.

Invariant:

```text
For every case in byId, every derived index agrees with byId.
For every ID in every derived index, byId contains that ID.
```

### 24.3 Differential testing

Compare optimized index against naive scan.

```text
Optimized findByState(state) == naive cases.stream().filter(state)
Optimized deadlineRange(a,b) == naive filter deadline between a,b
Optimized impactedCases(id) == reference BFS implementation
```

This is powerful because naive implementation is simpler and can serve as oracle.

### 24.4 Concurrency tests

If index is concurrent:

- readers should not see invalid snapshot,
- writers should not partially update indexes,
- no `ConcurrentModificationException`,
- no exposed mutable internal collections.

For serious concurrency correctness, unit tests are not enough. Use design simplification: actor, lock, or immutable snapshot.

---

## 25. Benchmark Plan

Benchmark should answer engineering questions, not produce vanity numbers.

Questions:

1. How many cases can index hold within memory budget?
2. How fast is `findById`?
3. How fast is `findByState` for small/large state buckets?
4. How fast is deadline range query for different bucket granularities?
5. How expensive is update state?
6. How expensive is full index rebuild?
7. How much allocation happens per query?
8. What is p95/p99 latency under realistic distribution?
9. Does `Instant` exact index create too many buckets?
10. Does materialization dominate query time?

### JMH benchmark sketch

```java
import org.openjdk.jmh.annotations.*;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;

@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.MICROSECONDS)
@State(Scope.Thread)
public class CaseIndexBenchmark {
    private CaseIndex index;

    @Param({"1000", "100000", "1000000"})
    int size;

    @Setup(Level.Trial)
    public void setup() {
        index = TestDataFactory.caseIndex(size);
    }

    @Benchmark
    public Object findByStateUnderReview() {
        return index.findByState(CaseState.UNDER_REVIEW);
    }

    @Benchmark
    public Object findDeadlineBefore() {
        return index.findDeadlineBefore(Instant.parse("2026-06-01T00:00:00Z"));
    }
}
```

Important:

- data distribution harus realistis,
- result size harus dikontrol,
- benchmark harus menghindari dead code elimination,
- jangan hanya benchmark hot key,
- benchmark update dan query terpisah,
- ukur allocation rate.

### JOL measurement

Gunakan JOL untuk membandingkan memory footprint:

1. `HashMap<CaseId, CaseRecord>`,
2. `EnumMap<CaseState, Set<CaseId>>`,
3. `TreeMap<Instant, Set<CaseId>>`,
4. dense array alternative,
5. priority queue with stale items.

Tujuannya bukan sekadar tahu angka, tetapi memahami object graph.

---

## 26. API Boundary: In-Memory Engine vs Database

Engine ini in-memory. Dalam sistem enterprise, data source biasanya database.

Jangan salah memahami capstone ini sebagai pengganti database index.

In-memory index cocok untuk:

1. hot working set,
2. workflow config,
3. rule registry,
4. per-request computation,
5. batch validation,
6. cache/read model,
7. simulation engine,
8. dependency analysis snapshot.

Database tetap cocok untuk:

1. durability,
2. cross-node consistency,
3. large historical query,
4. transactional write,
5. reporting over massive dataset,
6. access control at persistence boundary.

Realistic architecture:

```text
Database / Event Stream
        |
        v
Snapshot Builder / Projector
        |
        v
Immutable In-Memory Index Snapshot
        |
        v
Workflow / Rule / Query Engine
```

For write path:

```text
Command -> Validate against snapshot -> Persist transaction -> Publish event -> Update projection
```

Potential consistency model:

- command validation uses current snapshot,
- DB transaction is source of truth,
- projection eventually catches up,
- conflict detection needed if state changed between validation and commit.

---

## 27. Production-Grade Design Checklist

Use this checklist before choosing data structures.

### 27.1 Data shape

- How many records?
- How many active records?
- How many historical records?
- Are keys dense or sparse?
- Are enum dimensions bounded?
- Is ordering required?
- Are range queries required?

### 27.2 Operation mix

- Read-heavy or write-heavy?
- Point lookup or scan?
- Range query or exact lookup?
- Batch update or single update?
- Top-K/priority retrieval?
- Graph traversal?

### 27.3 Mutation model

- Is object mutable?
- Are keys immutable?
- Are indexes updated atomically?
- Is snapshot consistency required?
- Can readers tolerate stale data?

### 27.4 Complexity

- Big-O for each operation?
- Result-size cost included?
- Amortized spikes possible?
- Resize/rebuild cost understood?
- Worst-case behavior acceptable?

### 27.5 Memory

- How many objects per record?
- Are there many tiny sets/maps?
- Are references duplicated across indexes?
- Is primitive/dense representation worth it?
- Is GC pressure acceptable?

### 27.6 Concurrency

- Single writer?
- Multiple writers?
- Lock strategy?
- Snapshot replacement?
- Concurrent collections enough or not?
- Are multi-index updates atomic?

### 27.7 Failure modes

- Stale index?
- Mutable key?
- Comparator bug?
- Cycle?
- Unbounded queue/cache?
- Memory leak?
- Non-deterministic ordering?

### 27.8 Observability

- Index size by dimension?
- Bucket distribution?
- Deadline bucket count?
- Queue stale ratio?
- Rule evaluation latency?
- Cache hit/miss?
- Snapshot version?
- Rebuild duration?

### 27.9 Testing

- Unit invariant tests?
- Differential tests?
- Property-style random operation tests?
- Large dataset tests?
- Benchmark tests?
- Corruption simulation?

---

## 28. Final Integrated Example

A simplified production-ready shape:

```java
public final class CaseEngine {
    private final CaseIndex caseIndex;
    private final TransitionEngine transitionEngine;
    private final EscalationQueue escalationQueue;
    private final AuditIndex auditIndex;

    public CaseEngine(
            CaseIndex caseIndex,
            TransitionEngine transitionEngine,
            EscalationQueue escalationQueue,
            AuditIndex auditIndex
    ) {
        this.caseIndex = Objects.requireNonNull(caseIndex);
        this.transitionEngine = Objects.requireNonNull(transitionEngine);
        this.escalationQueue = Objects.requireNonNull(escalationQueue);
        this.auditIndex = Objects.requireNonNull(auditIndex);
    }

    public Optional<CaseRecord> findCase(CaseId id) {
        return caseIndex.findById(id);
    }

    public List<CaseRecord> casesByState(CaseState state) {
        return caseIndex.findByState(state);
    }

    public List<CaseRecord> overdueCases(Instant now) {
        return caseIndex.findDeadlineBefore(now);
    }

    public TransitionDecision transition(CaseId id, CaseState next, UserContext user, Instant now) {
        TransitionDecision decision = transitionEngine.transition(id, next, user, now);
        if (decision.approved()) {
            auditIndex.append(new AuditEvent(
                    id,
                    System.nanoTime(), // example only; production needs proper sequence
                    now,
                    user.userId(),
                    "TRANSITION",
                    "Transitioned to " + next
            ));
        }
        return decision;
    }

    public Optional<EscalationItem> nextEscalation() {
        return escalationQueue.pollValid();
    }

    public List<AuditEvent> latestAudit(CaseId id, int limit) {
        return auditIndex.latest(id, limit);
    }
}
```

Caveat:

`System.nanoTime()` is not a durable audit sequence. It is only shown as placeholder. Production audit sequence should come from a monotonic sequence generator or persistence layer.

---

## 29. What a Top-Tier Engineer Should See Here

A beginner sees:

```text
Use HashMap for lookup.
Use PriorityQueue for priority.
Use TreeMap for range.
```

A stronger engineer sees:

```text
Each structure implies an invariant, operation cost, mutation cost, memory cost, and failure mode.
```

A top-tier engineer asks:

1. What is the source of truth?
2. Which indexes are derived?
3. What operation mix justifies each index?
4. How are indexes updated atomically?
5. What are the key invariants?
6. How do we validate invariants?
7. What is the worst-case behavior?
8. What happens under stale data?
9. What happens under corrupt dependency graph?
10. How does this behave with 10x data?
11. How do we benchmark realistically?
12. How do we observe production drift?
13. How do we recover from index corruption?
14. Which structure should be replaced by DB index/search index/cache?
15. Which correctness property matters more than performance?

This is the real DSA skill.

---

## 30. Summary

Di capstone ini kita menyatukan hampir seluruh seri:

- `HashMap` untuk ID lookup,
- `EnumMap` dan `EnumSet` untuk bounded enum dimensions,
- `TreeMap`/`NavigableMap` untuk range query,
- `PriorityQueue` untuk escalation scheduling,
- graph traversal untuk dependency impact,
- DSU untuk duplicate clustering,
- immutable snapshot untuk workflow/rule config,
- defensive copy untuk boundary safety,
- validation untuk multi-index consistency,
- JMH/JOL untuk measurement,
- failure modelling untuk production correctness.

Pelajaran utamanya:

> Data structure design is not about selecting a container. It is about encoding domain invariants into operationally efficient, observable, testable, and recoverable structures.

Jika satu kalimat harus dibawa dari seluruh seri:

> Pilih struktur data berdasarkan operasi yang harus murah, invariant yang harus dijaga, failure yang harus dicegah, dan realitas Java runtime yang akan mengeksekusinya.

---

## 31. Status Seri

Seri `Java Data Structure and Algorithm Advanced` selesai.

Progress:

```text
Part 000 selesai
Part 001 selesai
Part 002 selesai
Part 003 selesai
Part 004 selesai
Part 005 selesai
Part 006 selesai
Part 007 selesai
Part 008 selesai
Part 009 selesai
Part 010 selesai
Part 011 selesai
Part 012 selesai
Part 013 selesai
Part 014 selesai
Part 015 selesai
Part 016 selesai
Part 017 selesai
Part 018 selesai
Part 019 selesai
Part 020 selesai
Part 021 selesai
Part 022 selesai
Part 023 selesai
Part 024 selesai
Part 025 selesai
Part 026 selesai
Part 027 selesai
Part 028 selesai
Part 029 selesai
Part 030 selesai
```

Ini adalah bagian terakhir dari seri.

---

## 32. Recommended Next Step Setelah Seri Ini

Setelah menyelesaikan seri DSA ini, langkah lanjut yang paling bernilai adalah membuat seri baru yang menerapkan DSA ke engineering system design, misalnya:

```text
Advanced Java System Design Patterns for Regulatory Case Management
```

Atau lebih spesifik:

```text
Java Rule Engine, Workflow Engine, and State Machine Design
```

Materi lanjutan ideal:

1. workflow engine design,
2. rule engine architecture,
3. state transition validation,
4. auditability,
5. temporal model,
6. event sourcing vs CRUD,
7. projection/read model,
8. consistency model,
9. indexing strategy,
10. regulatory defensibility.

Itu akan menjadi kelanjutan natural dari seri DSA ini.

---

## References

- Java Collections Framework Overview, Java SE 25.
- Java `HashMap`, `TreeMap`, `NavigableMap`, `PriorityQueue`, `EnumMap`, `EnumSet`, `BitSet` API documentation.
- OpenJDK JMH project documentation.
- OpenJDK JOL project documentation.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-dsa-part-029.md](./learn-java-dsa-part-029.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-reliability-part-000.md](../error_handling/learn-java-reliability-part-000.md)

</div>