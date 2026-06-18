# learn-java-oop-functional-reflection-codegen-modules-part-030

# Part 030 — Capstone: Designing a Modular, Reflective, Generated-Code Friendly Java Library

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Bagian: `030`  
> Status: **bagian terakhir / series selesai setelah bagian ini**  
> Fokus: menyatukan OOP, functional style, reflection, annotation processing, code generation, package architecture, JPMS, dependency governance, dan API evolution menjadi satu desain library Java production-grade.

---

## 0. Tujuan Part Ini

Pada bagian-bagian sebelumnya, kita membahas banyak konsep secara terpisah:

- object model
- type system
- class anatomy
- equality dan immutability
- encapsulation
- inheritance
- interface
- sealed hierarchy
- records
- enums
- nested classes
- generics
- polymorphism
- composition
- functional Java
- lambda
- functional interface
- error/null/result modeling
- reflection
- method handles
- annotations
- annotation processing
- code generation
- proxy/bytecode/instrumentation
- package architecture
- JPMS
- dependency governance
- API evolution

Part ini menjawab pertanyaan yang lebih besar:

> Jika kita harus membuat library Java serius yang akan dipakai banyak service, stabil dalam jangka panjang, bisa di-extend, bisa dianalisis, bisa generate code, bisa berjalan di classpath maupun module path, tidak merusak encapsulation, dan tahan terhadap evolusi API, seperti apa desainnya?

Kita akan membangun mental model dan blueprint.

Kita tidak akan membuat library main-main yang hanya berisi util function. Kita akan mendesain library internal enterprise yang punya:

- API publik minimal
- internal implementation tersembunyi
- SPI extension point
- annotation-based declarative model
- compile-time validation
- generated code
- optional reflection fallback
- JPMS descriptor
- dependency governance
- compatibility policy
- test strategy
- failure model

---

## 1. Studi Kasus Capstone

Kita akan memakai contoh library:

```text
caseflow-rules
```

Library ini digunakan untuk mendefinisikan, memvalidasi, dan mengeksekusi rule transisi case dalam sistem regulatory case management.

Contoh domain:

```text
DRAFT -> SUBMITTED -> UNDER_REVIEW -> DECISION_PENDING -> APPROVED
                                               └-----------> REJECTED
```

Library ini harus mampu:

1. mendefinisikan state machine secara type-safe;
2. mencegah transisi ilegal;
3. mendukung rule condition;
4. mendukung generated dispatcher agar runtime tidak terlalu reflection-heavy;
5. menyediakan SPI untuk plugin rule provider;
6. memberi error yang eksplisit;
7. aman untuk evolusi API;
8. bisa dipakai dari Maven/Gradle project biasa;
9. bisa dipakai dari modular Java project;
10. bisa dites dan diobservasi.

Kenapa contoh ini bagus?

Karena ia memaksa kita menggabungkan hampir semua konsep seri ini:

| Concern | Konsep yang Dipakai |
|---|---|
| State/domain modeling | enum, sealed interface, record |
| API contract | interface, generics, immutability |
| Behavior extension | functional interface, SPI, ServiceLoader |
| Runtime dynamic behavior | reflection, MethodHandle optional |
| Compile-time safety | annotation processing |
| Generated implementation | source generation |
| Encapsulation | package-private, internal package, JPMS exports |
| Build governance | Maven/Gradle dependency boundary |
| API evolution | semantic versioning, binary compatibility |

---

## 2. Mental Model: Library Serius Bukan Sekadar Kumpulan Class

Library production-grade minimal punya beberapa lapisan berbeda.

```text
consumer code
    |
    v
public API package
    |
    v
SPI package  <---------------- external provider/plugin
    |
    v
annotation package
    |
    v
generated code package
    |
    v
internal implementation package
    |
    v
runtime/platform dependencies
```

Setiap lapisan punya aturan berbeda.

| Lapisan | Boleh Diakses Consumer? | Stabilitas | Contoh |
|---|---:|---:|---|
| Public API | Ya | Sangat stabil | `RuleEngine`, `TransitionResult` |
| SPI | Ya, untuk extension | Stabil tapi lebih ketat | `RuleProvider` |
| Annotation API | Ya | Stabil | `@CaseFlow`, `@TransitionRule` |
| Generated API | Biasanya tidak langsung | Stabil secara kontrak, bukan nama internal | `GeneratedRuleRegistry` |
| Internal implementation | Tidak | Bebas berubah | `DefaultRuleEngine` |
| Test fixture | Opsional | Stabil terbatas | `caseflow-rules-testkit` |

Kesalahan umum adalah semua class dibuat `public`, semua package dianggap boleh dipakai, lalu ketika library harus berubah, downstream code pecah.

Top engineer berpikir dengan kalimat ini:

> Public API adalah janji jangka panjang. Internal implementation adalah kebebasan evolusi.

Kalau semuanya public, tidak ada ruang evolusi.

---

## 3. Prinsip Desain Capstone

Kita pakai prinsip berikut.

### 3.1 Public API Harus Kecil

API publik yang terlalu besar akan sulit dipertahankan.

Buruk:

```java
public class DefaultRuleEngine {
    public Map<String, Object> internalCache;
    public ReflectionScanner scanner;
    public List<RuleDescriptor> mutableRules;

    public void reloadEverything();
    public void scanClasspath();
    public void mutateDescriptor(RuleDescriptor descriptor);
}
```

Masalah:

- membocorkan implementation detail;
- field public;
- mutable internal state;
- consumer bisa bergantung ke class concrete;
- method terlalu operasional;
- sulit diganti menjadi generated dispatcher.

Lebih baik:

```java
public interface RuleEngine<S, C> {
    TransitionResult<S> transition(S currentState, String action, C context);
}
```

API ini kecil, fokus, dan behavior-oriented.

### 3.2 Internal Detail Harus Disembunyikan

```text
com.acme.caseflow.api       -> exported
com.acme.caseflow.spi       -> exported
com.acme.caseflow.annotation-> exported
com.acme.caseflow.internal  -> not exported
com.acme.caseflow.generated -> maybe not exported / generated into consumer module
```

Jika memakai JPMS:

```java
module com.acme.caseflow {
    exports com.acme.caseflow.api;
    exports com.acme.caseflow.spi;
    exports com.acme.caseflow.annotation;

    // no export for internal packages
}
```

Strong encapsulation memberi perlindungan yang tidak bisa diberikan package naming convention saja.

### 3.3 Extension Harus Lewat SPI, Bukan Reflection Acak

Buruk:

```java
Class<?> clazz = Class.forName(configuredClassName);
Object instance = clazz.getDeclaredConstructor().newInstance();
```

Lebih baik:

```java
public interface RuleProvider {
    Stream<RuleDefinition<?, ?>> rules();
}
```

Lalu ditemukan via:

```java
ServiceLoader<RuleProvider> loader = ServiceLoader.load(RuleProvider.class);
```

Keuntungan:

- contract jelas;
- lifecycle lebih mudah dikontrol;
- module-aware;
- bisa ditest;
- lebih aman daripada class name string bebas.

`ServiceLoader` memang dirancang untuk menemukan dan memuat provider service pada runtime.

### 3.4 Generated Code Harus Menambah Safety, Bukan Menambah Misteri

Generated code yang baik:

- deterministic;
- readable;
- punya source location comment;
- tidak menyembunyikan behavior domain;
- gagal di compile-time jika model salah;
- punya stable generated contract;
- tidak membuat developer takut membaca hasil generate.

Generated code yang buruk:

- membuat 10.000 baris kode tidak terbaca;
- memakai reflection acak;
- nama class tidak stabil;
- error baru muncul runtime;
- tidak punya mapping ke source annotation;
- sulit di-debug.

---

## 4. Struktur Project yang Disarankan

Untuk library serius, jangan langsung campur semua hal dalam satu artifact besar.

Struktur konseptual:

```text
caseflow-rules/
  caseflow-rules-api/
  caseflow-rules-spi/
  caseflow-rules-annotations/
  caseflow-rules-processor/
  caseflow-rules-runtime/
  caseflow-rules-testkit/
  caseflow-rules-bom/
```

Atau jika ingin lebih sederhana:

```text
caseflow-rules/
  api/
  annotations/
  processor/
  runtime/
  testkit/
```

### 4.1 Artifact: `caseflow-rules-api`

Berisi:

- public interfaces;
- immutable value types;
- sealed result types;
- exception base types bila perlu;
- zero/minimal dependency.

Package:

```text
com.acme.caseflow.api
```

Rule:

- dependency seminimal mungkin;
- tidak bergantung ke runtime implementation;
- tidak bergantung ke processor;
- tidak bergantung ke framework berat.

### 4.2 Artifact: `caseflow-rules-spi`

Berisi extension contract.

Package:

```text
com.acme.caseflow.spi
```

Contoh:

```java
public interface RuleProvider {
    Stream<RuleDefinition<?, ?>> rules();
}
```

SPI lebih sensitif daripada API biasa karena consumer bukan hanya memanggil method, tetapi mengimplementasikan contract.

Perubahan kecil pada SPI bisa merusak implementor.

### 4.3 Artifact: `caseflow-rules-annotations`

Berisi annotation yang dipakai consumer.

Package:

```text
com.acme.caseflow.annotation
```

Contoh:

```java
@Retention(RetentionPolicy.SOURCE)
@Target(ElementType.TYPE)
public @interface CaseFlow {
    Class<? extends Enum<?>> state();
}
```

Annotation SOURCE cocok jika hanya dipakai annotation processor. Annotation RUNTIME cocok jika runtime reflection memang diperlukan.

Jangan asal memakai `RUNTIME`.

### 4.4 Artifact: `caseflow-rules-processor`

Berisi annotation processor.

Package:

```text
com.acme.caseflow.processor
```

Rule:

- dipakai sebagai annotation processor path;
- tidak perlu menjadi runtime dependency;
- tidak boleh menginfeksi classpath aplikasi;
- harus memberi compiler error yang jelas.

### 4.5 Artifact: `caseflow-rules-runtime`

Berisi implementation runtime.

Package:

```text
com.acme.caseflow.runtime
com.acme.caseflow.internal
```

Rule:

- boleh punya dependency internal;
- boleh pakai reflection fallback;
- boleh pakai ServiceLoader;
- internal package tidak diekspor.

### 4.6 Artifact: `caseflow-rules-testkit`

Berisi helper testing.

Contoh:

```java
RuleEngineAssert.assertThat(engine)
    .from(CaseState.SUBMITTED)
    .when("approve")
    .with(context)
    .transitionsTo(CaseState.APPROVED);
```

Testkit mencegah consumer membuat testing helper acak yang bergantung ke internal implementation.

---

## 5. Public API Design

Kita mulai dari API paling kecil.

```java
package com.acme.caseflow.api;

public interface RuleEngine<S, C> {
    TransitionResult<S> transition(S currentState, String action, C context);
}
```

Pertanyaan desain:

1. Kenapa `S` generic?
2. Kenapa action `String`, bukan enum?
3. Kenapa context generic?
4. Kenapa return `TransitionResult<S>`, bukan throw exception?

### 5.1 State Generic

State bisa berupa:

- enum;
- sealed type;
- domain-specific class;
- generated state type.

Untuk library umum, generic memberi fleksibilitas.

Namun generic juga membuat runtime type tidak selalu tersedia karena erasure. Maka metadata state type perlu disediakan lewat descriptor.

```java
public interface RuleDefinition<S, C> {
    Class<S> stateType();
    Class<C> contextType();
    S from();
    String action();
    TransitionDecision<S> evaluate(C context);
}
```

### 5.2 Action sebagai String atau Enum?

Pilihan:

```java
String action
```

Kelebihan:

- mudah dari request/event;
- stabil lintas bahasa;
- mudah externalize.

Kekurangan:

- typo risk;
- tidak exhaustively checked.

Alternatif:

```java
A action
```

Dengan generic action:

```java
public interface RuleEngine<S, A, C> {
    TransitionResult<S> transition(S currentState, A action, C context);
}
```

Untuk capstone, kita pilih desain lebih type-safe:

```java
public interface RuleEngine<S, A, C> {
    TransitionResult<S> transition(S currentState, A action, C context);
}
```

### 5.3 Result, Bukan Boolean

Buruk:

```java
boolean canTransition(S from, A action, C context);
```

Masalah:

- tidak memberi reason;
- tidak memberi target state;
- tidak membedakan rule not found vs denied;
- tidak cocok untuk audit.

Lebih baik:

```java
public sealed interface TransitionResult<S>
        permits TransitionResult.Allowed,
                TransitionResult.Denied,
                TransitionResult.NotFound,
                TransitionResult.Failed {

    record Allowed<S>(S nextState) implements TransitionResult<S> {}

    record Denied<S>(String reasonCode, String message) implements TransitionResult<S> {}

    record NotFound<S>(String message) implements TransitionResult<S> {}

    record Failed<S>(String errorCode, String message, Throwable cause)
            implements TransitionResult<S> {}
}
```

Ini menggabungkan:

- sealed hierarchy;
- record;
- explicit error channel;
- exhaustive handling.

Consumer bisa menulis:

```java
return switch (result) {
    case TransitionResult.Allowed<CaseState> allowed -> proceed(allowed.nextState());
    case TransitionResult.Denied<CaseState> denied -> reject(denied.reasonCode());
    case TransitionResult.NotFound<CaseState> notFound -> failConfiguration(notFound.message());
    case TransitionResult.Failed<CaseState> failed -> escalate(failed.errorCode());
};
```

---

## 6. Domain Model: Enum, Record, Sealed Type

Contoh state:

```java
public enum CaseState {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    DECISION_PENDING,
    APPROVED,
    REJECTED
}
```

Contoh action:

```java
public enum CaseAction {
    SUBMIT,
    ASSIGN_REVIEWER,
    REQUEST_DECISION,
    APPROVE,
    REJECT
}
```

Context:

```java
public record CaseContext(
        String caseId,
        String officerId,
        boolean hasRequiredDocuments,
        boolean supervisorApprovalPresent
) {}
```

Kenapa record?

Karena context idealnya immutable value-carrying object.

Namun hati-hati:

- record immutable secara shallow;
- jika component berupa `List`, gunakan defensive copy;
- jangan memasukkan lazy mutable entity ke context.

---

## 7. Rule Definition API

Kita butuh definisi rule.

```java
public interface RuleDefinition<S, A, C> {
    S from();
    A action();
    Class<S> stateType();
    Class<A> actionType();
    Class<C> contextType();
    TransitionDecision<S> evaluate(C context);
}
```

Decision:

```java
public sealed interface TransitionDecision<S>
        permits TransitionDecision.Allow,
                TransitionDecision.Deny {

    record Allow<S>(S nextState) implements TransitionDecision<S> {}

    record Deny<S>(String reasonCode, String message) implements TransitionDecision<S> {}
}
```

Kenapa `TransitionDecision` dipisah dari `TransitionResult`?

Karena decision adalah hasil rule business, sedangkan result adalah hasil engine runtime.

```text
Rule evaluation:
  allow / deny

Engine execution:
  allowed / denied / not found / failed
```

Perbedaan ini penting untuk audit dan observability.

---

## 8. Functional API untuk Rule

Agar rule mudah dibuat, kita bisa definisikan functional interface.

```java
@FunctionalInterface
public interface RuleCondition<C> {
    boolean test(C context);
}
```

Tapi boolean terlalu miskin.

Lebih baik:

```java
@FunctionalInterface
public interface TransitionPolicy<S, C> {
    TransitionDecision<S> decide(C context);
}
```

Lalu rule bisa dibuat:

```java
public final class Rules {
    public static <S, A, C> RuleDefinition<S, A, C> rule(
            Class<S> stateType,
            Class<A> actionType,
            Class<C> contextType,
            S from,
            A action,
            TransitionPolicy<S, C> policy
    ) {
        return new SimpleRuleDefinition<>(stateType, actionType, contextType, from, action, policy);
    }
}
```

Public API tetap kecil, tetapi expressive.

Contoh consumer:

```java
RuleDefinition<CaseState, CaseAction, CaseContext> submitRule = Rules.rule(
        CaseState.class,
        CaseAction.class,
        CaseContext.class,
        CaseState.DRAFT,
        CaseAction.SUBMIT,
        ctx -> ctx.hasRequiredDocuments()
                ? new TransitionDecision.Allow<>(CaseState.SUBMITTED)
                : new TransitionDecision.Deny<>("MISSING_DOCS", "Required documents are missing")
);
```

---

## 9. Internal Implementation

Public API:

```java
public interface RuleEngine<S, A, C> {
    TransitionResult<S> transition(S currentState, A action, C context);
}
```

Internal implementation:

```java
package com.acme.caseflow.internal;

final class DefaultRuleEngine<S, A, C> implements RuleEngine<S, A, C> {
    private final Map<RuleKey<S, A>, RuleDefinition<S, A, C>> rules;

    DefaultRuleEngine(List<RuleDefinition<S, A, C>> definitions) {
        this.rules = index(definitions);
    }

    @Override
    public TransitionResult<S> transition(S currentState, A action, C context) {
        RuleDefinition<S, A, C> rule = rules.get(new RuleKey<>(currentState, action));

        if (rule == null) {
            return new TransitionResult.NotFound<>(
                    "No rule found for state=" + currentState + ", action=" + action
            );
        }

        try {
            TransitionDecision<S> decision = rule.evaluate(context);
            return switch (decision) {
                case TransitionDecision.Allow<S> allow ->
                        new TransitionResult.Allowed<>(allow.nextState());
                case TransitionDecision.Deny<S> deny ->
                        new TransitionResult.Denied<>(deny.reasonCode(), deny.message());
            };
        } catch (RuntimeException ex) {
            return new TransitionResult.Failed<>(
                    "RULE_EVALUATION_FAILED",
                    "Rule evaluation failed",
                    ex
            );
        }
    }

    private Map<RuleKey<S, A>, RuleDefinition<S, A, C>> index(
            List<RuleDefinition<S, A, C>> definitions
    ) {
        Map<RuleKey<S, A>, RuleDefinition<S, A, C>> map = new LinkedHashMap<>();
        for (RuleDefinition<S, A, C> definition : definitions) {
            RuleKey<S, A> key = new RuleKey<>(definition.from(), definition.action());
            RuleDefinition<S, A, C> previous = map.putIfAbsent(key, definition);
            if (previous != null) {
                throw new IllegalArgumentException("Duplicate rule: " + key);
            }
        }
        return Map.copyOf(map);
    }
}
```

Key:

```java
package com.acme.caseflow.internal;

record RuleKey<S, A>(S state, A action) {}
```

Kenapa `RuleKey` internal?

Karena itu implementation detail.

Kalau nanti key diganti menjadi generated switch, public API tidak berubah.

---

## 10. Factory API

Consumer tidak perlu tahu `DefaultRuleEngine`.

```java
package com.acme.caseflow.api;

public final class RuleEngines {
    private RuleEngines() {}

    public static <S, A, C> RuleEngine<S, A, C> of(
            List<RuleDefinition<S, A, C>> rules
    ) {
        return InternalRuleEngineFactory.create(rules);
    }
}
```

Namun `InternalRuleEngineFactory` tidak boleh public API.

```java
package com.acme.caseflow.internal;

public final class InternalRuleEngineFactory {
    private InternalRuleEngineFactory() {}

    public static <S, A, C> RuleEngine<S, A, C> create(
            List<RuleDefinition<S, A, C>> rules
    ) {
        return new DefaultRuleEngine<>(rules);
    }
}
```

Catatan: jika `InternalRuleEngineFactory` public tetapi package tidak diekspor di JPMS, consumer modular tidak bisa mengaksesnya. Di classpath, naming convention tetap harus dijaga dengan documentation dan tooling.

---

## 11. Annotation Model

Kita ingin consumer bisa menulis declarative rules.

```java
@CaseFlow(
        state = CaseState.class,
        action = CaseAction.class,
        context = CaseContext.class
)
public interface CaseFlowDefinition {

    @Transition(
            from = "DRAFT",
            on = "SUBMIT",
            to = "SUBMITTED"
    )
    boolean submit(CaseContext context);
}
```

Masalah: annotation element tidak bisa langsung menerima enum generic dari unknown enum type secara fleksibel. Jika memakai `String`, ada typo risk.

Alternatif lebih type-safe:

```java
@CaseFlow(
        state = CaseState.class,
        action = CaseAction.class,
        context = CaseContext.class
)
public interface CaseFlowDefinition {

    @Transition(from = "DRAFT", on = "SUBMIT", to = "SUBMITTED")
    TransitionDecision<CaseState> submit(CaseContext context);
}
```

Processor harus memvalidasi:

- `DRAFT` adalah constant dari `CaseState`;
- `SUBMIT` adalah constant dari `CaseAction`;
- `SUBMITTED` adalah constant dari `CaseState`;
- method menerima tepat satu parameter `CaseContext`;
- return type valid;
- tidak ada duplicate `(from, action)`;
- semua required transition ada jika policy mengharuskan;
- tidak ada unreachable state jika check diaktifkan.

Annotation:

```java
@Retention(RetentionPolicy.SOURCE)
@Target(ElementType.TYPE)
public @interface CaseFlow {
    Class<? extends Enum<?>> state();
    Class<? extends Enum<?>> action();
    Class<?> context();
}
```

```java
@Retention(RetentionPolicy.SOURCE)
@Target(ElementType.METHOD)
public @interface Transition {
    String from();
    String on();
    String to();
}
```

Kenapa `SOURCE`?

Karena annotation hanya dibaca processor. Tidak perlu membawanya ke runtime.

---

## 12. Annotation Processor sebagai Compiler Kecil

Processor harus:

1. menemukan type dengan `@CaseFlow`;
2. membaca metadata annotation;
3. membaca method dengan `@Transition`;
4. memvalidasi shape method;
5. memvalidasi enum constants;
6. membangun model internal;
7. menghasilkan source code;
8. melaporkan error dengan lokasi yang tepat.

Skeleton:

```java
@SupportedAnnotationTypes("com.acme.caseflow.annotation.CaseFlow")
@SupportedSourceVersion(SourceVersion.RELEASE_25)
public final class CaseFlowProcessor extends AbstractProcessor {

    @Override
    public boolean process(
            Set<? extends TypeElement> annotations,
            RoundEnvironment roundEnv
    ) {
        for (Element element : roundEnv.getElementsAnnotatedWith(CaseFlow.class)) {
            if (element.getKind() != ElementKind.INTERFACE) {
                error(element, "@CaseFlow can only be used on interfaces");
                continue;
            }

            TypeElement type = (TypeElement) element;
            processCaseFlow(type);
        }
        return false;
    }

    private void processCaseFlow(TypeElement type) {
        // 1. read annotation mirror
        // 2. validate methods
        // 3. build model
        // 4. generate source
    }

    private void error(Element element, String message) {
        processingEnv.getMessager().printMessage(Diagnostic.Kind.ERROR, message, element);
    }
}
```

Important processor rule:

> Do not use reflection to inspect source model in annotation processor. Use `Element` and `TypeMirror`.

Reflection sees compiled runtime classes. Annotation processing sees language model during compilation.

---

## 13. Generated Code Contract

Generated class could be:

```java
package com.acme.generated.caseflow;

public final class CaseFlowDefinition_CaseFlowRegistry
        implements RuleProvider {

    @Override
    public Stream<RuleDefinition<?, ?, ?>> rules() {
        return Stream.of(
                Rules.rule(
                        CaseState.class,
                        CaseAction.class,
                        CaseContext.class,
                        CaseState.DRAFT,
                        CaseAction.SUBMIT,
                        this::submit
                )
        );
    }

    private TransitionDecision<CaseState> submit(CaseContext context) {
        if (context.hasRequiredDocuments()) {
            return new TransitionDecision.Allow<>(CaseState.SUBMITTED);
        }
        return new TransitionDecision.Deny<>("MISSING_DOCS", "Required documents are missing");
    }
}
```

But this example hides a problem: how does generated code know business logic?

There are several models.

### 13.1 Annotation Only Describes Static Transition

```java
@Transition(from = "DRAFT", on = "SUBMIT", to = "SUBMITTED")
void submit();
```

Generated rule always allows transition.

Good for simple workflows, poor for conditional rules.

### 13.2 Annotation Points to Method Implementation

Consumer writes:

```java
@CaseFlow(...)
public final class CaseFlowRules {

    @Transition(from = "DRAFT", on = "SUBMIT", to = "SUBMITTED")
    public TransitionDecision<CaseState> submit(CaseContext context) {
        if (context.hasRequiredDocuments()) {
            return new TransitionDecision.Allow<>(CaseState.SUBMITTED);
        }
        return new TransitionDecision.Deny<>("MISSING_DOCS", "Required documents are missing");
    }
}
```

Generated code invokes this method.

Problem:

- if method is private, access issue;
- if class requires dependency injection, generation must respect lifecycle;
- if method throws, generated wrapper must handle.

### 13.3 Annotation Generates Descriptor, Runtime Invokes Bean Method

Generated descriptor:

```java
new MethodRuleDescriptor(
    CaseFlowRules.class,
    "submit",
    CaseState.DRAFT,
    CaseAction.SUBMIT,
    CaseState.SUBMITTED
)
```

Runtime framework invokes method using reflection or method handle.

Trade-off:

- more flexible;
- less compile-time direct;
- needs access policy;
- more JPMS-sensitive.

### 13.4 Recommended Hybrid

For enterprise library:

- generate static metadata at compile time;
- validate as much as possible at compile time;
- let runtime bind actual service instance via explicit interface/SPI;
- avoid deep reflection unless explicitly opened.

---

## 14. Runtime Binding Model

Consumer implements:

```java
public final class CaseFlowRules {

    @Transition(from = "DRAFT", on = "SUBMIT", to = "SUBMITTED")
    public TransitionDecision<CaseState> submit(CaseContext context) {
        if (context.hasRequiredDocuments()) {
            return new TransitionDecision.Allow<>(CaseState.SUBMITTED);
        }
        return new TransitionDecision.Deny<>("MISSING_DOCS", "Required documents are missing");
    }
}
```

Processor generates metadata:

```java
public final class CaseFlowRules_Metadata {
    public static final List<GeneratedTransitionDescriptor> TRANSITIONS = List.of(
            new GeneratedTransitionDescriptor(
                    "submit",
                    CaseState.DRAFT,
                    CaseAction.SUBMIT,
                    CaseState.SUBMITTED,
                    CaseContext.class
            )
    );
}
```

Runtime binds:

```java
public final class ReflectiveRuleBinder {
    public <S, A, C> List<RuleDefinition<S, A, C>> bind(Object ruleObject, GeneratedFlowMetadata metadata) {
        // validate methods exist
        // create method handles or reflective invokers
        // return RuleDefinition list
    }
}
```

If JPMS is used, user module must explicitly open the package if deep reflection is required:

```java
opens com.acme.myapp.rules to com.acme.caseflow.runtime;
```

Better if method is public and no deep reflection is needed, but frameworks often still need access.

---

## 15. SPI with ServiceLoader

SPI:

```java
package com.acme.caseflow.spi;

public interface RuleProvider {
    Stream<RuleDefinition<?, ?, ?>> rules();
}
```

Generated provider:

```java
public final class CaseFlowRulesProvider implements RuleProvider {
    @Override
    public Stream<RuleDefinition<?, ?, ?>> rules() {
        return CaseFlowRules_Metadata.createRules();
    }
}
```

Classpath registration:

```text
META-INF/services/com.acme.caseflow.spi.RuleProvider
```

Content:

```text
com.acme.generated.caseflow.CaseFlowRulesProvider
```

JPMS registration:

```java
module com.acme.myapp.rules {
    requires com.acme.caseflow;

    provides com.acme.caseflow.spi.RuleProvider
        with com.acme.generated.caseflow.CaseFlowRulesProvider;
}
```

Runtime:

```java
ServiceLoader<RuleProvider> loader = ServiceLoader.load(RuleProvider.class);
List<RuleDefinition<?, ?, ?>> rules = loader.stream()
        .map(ServiceLoader.Provider::get)
        .flatMap(provider -> provider.rules())
        .toList();
```

This keeps extension explicit.

---

## 16. JPMS Descriptor

Library module:

```java
module com.acme.caseflow {
    exports com.acme.caseflow.api;
    exports com.acme.caseflow.spi;
    exports com.acme.caseflow.annotation;

    requires java.compiler; // only if processor is in same artifact, usually avoid

    uses com.acme.caseflow.spi.RuleProvider;
}
```

Better split:

### API module

```java
module com.acme.caseflow.api {
    exports com.acme.caseflow.api;
}
```

### SPI module

```java
module com.acme.caseflow.spi {
    requires transitive com.acme.caseflow.api;
    exports com.acme.caseflow.spi;
}
```

### Annotation module

```java
module com.acme.caseflow.annotation {
    exports com.acme.caseflow.annotation;
}
```

### Runtime module

```java
module com.acme.caseflow.runtime {
    requires com.acme.caseflow.api;
    requires com.acme.caseflow.spi;

    uses com.acme.caseflow.spi.RuleProvider;

    exports com.acme.caseflow.runtime;
}
```

### Processor module

```java
module com.acme.caseflow.processor {
    requires java.compiler;
    requires com.acme.caseflow.annotation;
    requires com.acme.caseflow.api;

    provides javax.annotation.processing.Processor
        with com.acme.caseflow.processor.CaseFlowProcessor;
}
```

Practical note:

Many projects keep annotation processors as non-modular or automatic modules because processor wiring and build tool behavior can be more complex. That is okay if documented.

---

## 17. Maven Governance

Recommended dependency use by consumer:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.acme.caseflow</groupId>
      <artifactId>caseflow-rules-bom</artifactId>
      <version>1.4.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Runtime dependencies:

```xml
<dependencies>
  <dependency>
    <groupId>com.acme.caseflow</groupId>
    <artifactId>caseflow-rules-api</artifactId>
  </dependency>
  <dependency>
    <groupId>com.acme.caseflow</groupId>
    <artifactId>caseflow-rules-runtime</artifactId>
  </dependency>
  <dependency>
    <groupId>com.acme.caseflow</groupId>
    <artifactId>caseflow-rules-annotations</artifactId>
    <scope>provided</scope>
  </dependency>
</dependencies>
```

Annotation processor path:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <annotationProcessorPaths>
      <path>
        <groupId>com.acme.caseflow</groupId>
        <artifactId>caseflow-rules-processor</artifactId>
        <version>${caseflow.version}</version>
      </path>
    </annotationProcessorPaths>
  </configuration>
</plugin>
```

Important:

- processor should not leak into runtime classpath;
- BOM aligns versions;
- runtime should not depend on compiler APIs;
- API artifact should not depend on processor artifact.

---

## 18. Gradle Governance

```kotlin
dependencies {
    implementation(platform("com.acme.caseflow:caseflow-rules-bom:1.4.0"))

    implementation("com.acme.caseflow:caseflow-rules-api")
    implementation("com.acme.caseflow:caseflow-rules-runtime")
    compileOnly("com.acme.caseflow:caseflow-rules-annotations")
    annotationProcessor("com.acme.caseflow:caseflow-rules-processor")

    testImplementation("com.acme.caseflow:caseflow-rules-testkit")
}
```

For library project:

```kotlin
dependencies {
    api("com.acme.caseflow:caseflow-rules-api")
    implementation("com.acme.caseflow:caseflow-rules-runtime")
}
```

Rule:

- use `api` only when dependency appears in public ABI;
- use `implementation` for internal detail;
- use `compileOnly` for annotations if not needed runtime;
- use `annotationProcessor` for processor.

---

## 19. Compatibility Policy

The library should publish a compatibility contract.

Example:

```text
Compatibility Policy

Public API packages:
- com.acme.caseflow.api
- com.acme.caseflow.spi
- com.acme.caseflow.annotation

Internal packages:
- com.acme.caseflow.internal
- com.acme.caseflow.generated.internal

Semantic versioning:
- Patch: bug fix, no public API change
- Minor: backward-compatible public API addition
- Major: breaking public API/SPI behavior change

Generated code:
- Generated class names are not public API unless explicitly documented
- Generated metadata schema is internal unless exported through api package

Reflection:
- Deep reflection is not guaranteed unless package is explicitly opened

JPMS:
- Exported packages are public API
- Non-exported packages may change without notice
```

### 19.1 API Additions

Usually safe:

- adding new class;
- adding new static factory;
- adding new default method carefully;
- adding new record-independent utility.

Risky:

- adding abstract method to interface;
- adding enum constant if consumers use exhaustive switch without default;
- adding permitted subclass to sealed hierarchy;
- changing annotation default;
- changing generated source naming.

### 19.2 SPI Evolution

SPI is harder than API.

If you add method to SPI:

```java
public interface RuleProvider {
    Stream<RuleDefinition<?, ?, ?>> rules();
    String providerName(); // breaking for implementors
}
```

Better:

```java
public interface RuleProvider {
    Stream<RuleDefinition<?, ?, ?>> rules();

    default String providerName() {
        return getClass().getName();
    }
}
```

But even default method may introduce conflicts in complex multiple-interface hierarchies.

---

## 20. Error Model

Library should not throw random exceptions for normal business decisions.

### 20.1 Business Result

```java
TransitionResult.Denied
TransitionResult.NotFound
```

### 20.2 Misconfiguration

Should fail at startup or compile time.

Examples:

- duplicate transition;
- unknown enum constant;
- invalid annotated method signature;
- incompatible context type;
- provider cannot be loaded.

Use exception:

```java
public final class RuleConfigurationException extends RuntimeException {
    public RuleConfigurationException(String message) {
        super(message);
    }

    public RuleConfigurationException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

### 20.3 Technical Failure

During invocation:

- method throws;
- provider fails;
- reflection access denied;
- module not opened;
- classloader mismatch.

Return `TransitionResult.Failed` if failure is per-transition. Throw `RuleEngineInitializationException` if engine cannot start.

---

## 21. Observability Design

A serious library should support observability without forcing one logging framework.

Bad:

```java
private static final Logger log = LoggerFactory.getLogger(DefaultRuleEngine.class);
```

This is not always bad, but hard-coding logging behavior as the only observability channel is limiting.

Better expose listener/hook:

```java
public interface RuleEngineListener {
    void beforeEvaluation(RuleEvaluationEvent event);
    void afterEvaluation(RuleEvaluationResultEvent event);
    void onEvaluationFailure(RuleEvaluationFailureEvent event);
}
```

But do not overdo it. Too many hooks become hidden framework.

Minimal event model:

```java
public record RuleEvaluationEvent(
        String ruleId,
        Object state,
        Object action,
        String contextType
) {}
```

Avoid putting sensitive context data into logs by default.

For regulatory systems, observability must distinguish:

- audit event;
- debug log;
- metric;
- trace span;
- business decision evidence.

Do not mix all four.

---

## 22. Security and Data Boundary

Even though this series is not the security series, this capstone must respect secure design.

Rules:

1. Do not log full context by default.
2. Do not expose reflective access broadly.
3. Do not scan arbitrary classpath packages unless explicitly configured.
4. Do not load provider class by untrusted string from request/user input.
5. Do not generate source code from unsanitized external text.
6. Do not make internal package exported just to fix framework access quickly.
7. Do not let generated code bypass authorization.

Generated code is still code.

Annotation processor is still code execution during build.

Java agent/instrumentation is still privileged runtime modification.

Treat them as supply-chain sensitive.

---

## 23. Testing Strategy

A production-grade library needs layered tests.

### 23.1 API Contract Tests

Test:

- immutability;
- equality;
- sealed result handling;
- factory behavior;
- null validation;
- error messages.

### 23.2 Rule Engine Tests

```java
@Test
void allowsSubmitWhenDocumentsAreComplete() {
    RuleEngine<CaseState, CaseAction, CaseContext> engine = RuleEngines.of(List.of(submitRule));

    TransitionResult<CaseState> result = engine.transition(
            CaseState.DRAFT,
            CaseAction.SUBMIT,
            new CaseContext("C-1", "O-1", true, false)
    );

    assertThat(result).isEqualTo(new TransitionResult.Allowed<>(CaseState.SUBMITTED));
}
```

### 23.3 Processor Tests

Use compile-testing style approach:

- input source file;
- run processor;
- assert compilation success/failure;
- assert generated source;
- assert diagnostic message.

Test cases:

- invalid annotation target;
- unknown enum constant;
- duplicate transition;
- invalid return type;
- invalid context parameter;
- generated source compiles;
- incremental behavior if supported.

### 23.4 JPMS Tests

Test with:

- classpath;
- module path;
- package not opened;
- package opened;
- service provider via `provides`;
- service provider via `META-INF/services`.

### 23.5 Compatibility Tests

Keep fixtures from old versions.

Test:

- old consumer binary with new library;
- generated code from old processor with new runtime if supported;
- old annotation usage with new processor;
- SPI implementor compatibility.

### 23.6 Golden File Tests

Generated code should be compared to golden output if deterministic.

But avoid brittle formatting-only assertions. Normalize line endings and stable timestamps.

Generated files should not include current time unless explicitly necessary.

---

## 24. Documentation Strategy

Documentation should not only describe methods.

It should define contracts.

Minimum docs:

```text
README.md
docs/
  architecture.md
  public-api.md
  spi-guide.md
  annotation-processing.md
  jpms-guide.md
  migration-guide.md
  compatibility-policy.md
  generated-code-policy.md
  troubleshooting.md
```

### 24.1 Public API Docs

Explain:

- what is stable;
- what is internal;
- null policy;
- exception policy;
- thread-safety;
- immutability;
- lifecycle;
- module path usage.

### 24.2 SPI Docs

Explain:

- when provider is loaded;
- whether provider must be stateless;
- whether provider may throw;
- thread-safety requirement;
- whether provider order matters;
- duplicate rule handling.

### 24.3 Annotation Processor Docs

Explain:

- supported Java versions;
- supported build tools;
- generated source location;
- incremental compilation status;
- diagnostic examples;
- JPMS caveats.

---

## 25. Failure Model

A top engineer asks:

> How can this design fail?

### 25.1 Compile-Time Failures

| Failure | Example | Desired Behavior |
|---|---|---|
| Invalid annotation target | `@CaseFlow` on class when only interface supported | Compiler error |
| Unknown state | `from="DRAFFT"` | Compiler error with suggestion |
| Duplicate transition | two rules for same state/action | Compiler error |
| Bad method signature | method has wrong context parameter | Compiler error |
| Generated source invalid | processor bug | Processor test catches |

### 25.2 Startup Failures

| Failure | Example | Desired Behavior |
|---|---|---|
| Duplicate providers | same rule from multiple providers | Fail fast or configured precedence |
| Provider load failed | constructor throws | Initialization exception |
| Module not readable | missing requires | Clear module error |
| Package not opened | reflection denied | Clear instruction |
| Version mismatch | generated metadata v1, runtime v2 incompatible | Clear compatibility exception |

### 25.3 Runtime Failures

| Failure | Example | Desired Behavior |
|---|---|---|
| Rule denies | missing document | `Denied` result |
| Rule not found | unknown action | `NotFound` result |
| Rule throws | NPE in user rule | `Failed` result or configured throw |
| Context wrong type | bad generic boundary | configuration error if possible |
| Slow rule | external call in rule | timeout must be owned by caller/runtime policy |

### 25.4 Operational Failures

| Failure | Example | Mitigation |
|---|---|---|
| Excessive reflection | slow startup | generated metadata/cache |
| Classloader leak | provider retained after reload | lifecycle close/weak boundary |
| Log leakage | context contains PII | redaction by default |
| Dependency conflict | processor/runtime mismatch | BOM and version check |
| Observability noise | too many events | sampling/configurable listener |

---

## 26. Refactoring Roadmap from Naive Implementation

Suppose you start with this:

```java
public class CaseService {
    public String submit(String state, Map<String, Object> context) {
        if (state.equals("DRAFT")) {
            if ((boolean) context.get("hasDocs")) {
                return "SUBMITTED";
            }
            throw new IllegalStateException("Missing docs");
        }
        throw new IllegalStateException("Invalid state");
    }
}
```

### Step 1 — Replace String State with Enum

```java
enum CaseState { DRAFT, SUBMITTED }
```

### Step 2 — Replace Map Context with Record

```java
record CaseContext(boolean hasRequiredDocuments) {}
```

### Step 3 — Replace Exception Business Flow with Result

```java
TransitionResult<CaseState> submit(CaseState state, CaseContext context)
```

### Step 4 — Extract RuleDefinition

```java
RuleDefinition<CaseState, CaseAction, CaseContext>
```

### Step 5 — Build RuleEngine

```java
RuleEngine<CaseState, CaseAction, CaseContext>
```

### Step 6 — Move Implementation Internal

```text
api -> public
internal -> hidden
```

### Step 7 — Add Processor for Validation

Compile-time validation replaces runtime discovery errors.

### Step 8 — Add Generated Registry

Avoid repeated reflection scanning.

### Step 9 — Add JPMS Descriptor

Declare real module boundary.

### Step 10 — Add Compatibility Tests

Prevent future breaking changes.

---

## 27. Design Review Checklist

Use this as review gate.

### 27.1 API Checklist

- Is public API minimal?
- Are public types immutable where possible?
- Are names domain meaningful?
- Is null policy explicit?
- Is exception policy explicit?
- Are result types expressive enough?
- Are generics necessary and understandable?
- Are records safe from mutable component leakage?
- Are sealed hierarchies stable enough?
- Are enums persisted by stable code, not ordinal?

### 27.2 Encapsulation Checklist

- Are internal packages hidden?
- Are implementation classes package-private/final where appropriate?
- Are constructors controlled?
- Are mutable collections defensively copied?
- Are reflection openings minimal?
- Are generated packages documented?

### 27.3 SPI Checklist

- Is SPI separate from implementation?
- Are SPI methods stable?
- Is provider lifecycle defined?
- Is provider ordering defined?
- Are duplicate providers handled?
- Is ServiceLoader registration documented?

### 27.4 Annotation Processor Checklist

- Are diagnostics actionable?
- Are invalid models caught at compile time?
- Is generated code deterministic?
- Does processor avoid runtime reflection?
- Is processor isolated from runtime classpath?
- Are generated types stable enough?

### 27.5 JPMS Checklist

- Are only API/SPI/annotation packages exported?
- Are internal packages not exported?
- Are `opens` qualified where possible?
- Is `requires transitive` used only when needed?
- Are automatic module names stable?
- Are split packages avoided?

### 27.6 Dependency Checklist

- Is API artifact dependency-light?
- Is processor not runtime dependency?
- Is BOM provided?
- Are dependency versions locked/verified?
- Are optional dependencies documented?
- Is shading avoided unless truly needed?

### 27.7 Compatibility Checklist

- Is public API documented?
- Is internal API clearly marked?
- Are binary compatibility tests present?
- Are old generated sources tested with new runtime if promised?
- Is deprecation strategy clear?
- Is migration guide provided for breaking changes?

---

## 28. Common Anti-Patterns

### 28.1 Public Everything

```java
public class DefaultRuleEngine
public class RuleCache
public class ReflectionScanner
public class InternalRuleDescriptor
```

Symptom:

- consumer depends on internal class;
- library cannot evolve.

Fix:

- public interface;
- internal implementation;
- factory;
- JPMS exports only API.

### 28.2 Annotation as Hidden Programming Language

```java
@Rule(
    expression = "state == 'DRAFT' && ctx.docs > 0 && user.role in ['ADMIN']"
)
```

This creates a new language without compiler support, refactoring support, type safety, or debugability.

Fix:

- use Java code for complex logic;
- annotation for metadata;
- processor for validation.

### 28.3 Reflection as Architecture

Reflection is a tool, not a design model.

Bad:

```java
scanEverything();
setAccessible(true);
invokeByName();
```

Fix:

- explicit API;
- explicit SPI;
- generated metadata;
- qualified opens if needed.

### 28.4 Generated Code No One Can Read

If generated code cannot be inspected, debugged, or mapped to source, it becomes operational debt.

Fix:

- deterministic naming;
- readable output;
- source comments;
- stable metadata schema;
- golden tests.

### 28.5 SPI That Is Actually Internal

If SPI exposes internal descriptors, all implementors become coupled to implementation.

Bad:

```java
public interface RuleProvider {
    List<InternalRuleDescriptor> loadInternalDescriptors(InternalCache cache);
}
```

Fix:

```java
public interface RuleProvider {
    Stream<RuleDefinition<?, ?, ?>> rules();
}
```

---

## 29. Final Architecture Blueprint

```text
+-------------------------------------------------------------+
| Consumer Application                                         |
|                                                             |
|  @CaseFlow annotated rule classes                            |
|  generated RuleProvider                                      |
|  module-info provides RuleProvider                           |
+-----------------------------+-------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| caseflow-rules-annotations                                  |
|                                                             |
|  @CaseFlow                                                   |
|  @Transition                                                 |
+-------------------------------------------------------------+
                              |
                              v compile-time
+-------------------------------------------------------------+
| caseflow-rules-processor                                     |
|                                                             |
|  validates annotated model                                   |
|  generates provider/metadata                                 |
+-------------------------------------------------------------+
                              |
                              v runtime
+-------------------------------------------------------------+
| caseflow-rules-api                                           |
|                                                             |
|  RuleEngine                                                  |
|  RuleDefinition                                              |
|  TransitionResult                                            |
|  TransitionDecision                                          |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| caseflow-rules-spi                                           |
|                                                             |
|  RuleProvider                                                |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
| caseflow-rules-runtime                                       |
|                                                             |
|  RuleEngines factory                                         |
|  DefaultRuleEngine internal                                  |
|  ServiceLoader integration                                   |
|  optional reflection/method-handle binder                    |
+-------------------------------------------------------------+
```

Module boundary:

```text
exports api
exports spi
exports annotation
hide internal
use/provide provider
qualified opens only when needed
```

Dependency boundary:

```text
api        -> minimal
spi        -> api
annotation -> minimal
processor  -> annotation + compiler API
runtime    -> api + spi
consumer   -> api + runtime + annotations compileOnly + processor annotationProcessor
```

---

## 30. What “Top 1% Java Engineer” Means in This Context

Not someone who merely knows every keyword.

A high-level Java engineer can reason across layers:

```text
source code
  -> type system
  -> bytecode implication
  -> runtime dispatch
  -> reflection/proxy behavior
  -> JPMS/package boundary
  -> dependency graph
  -> generated code lifecycle
  -> binary compatibility
  -> operational failure mode
```

They do not ask only:

> Can I implement this?

They ask:

> Can this evolve safely?
> Can it fail predictably?
> Can downstream teams use it without depending on internals?
> Can build tools and IDEs understand it?
> Can module boundaries enforce what documentation promises?
> Can generated code be tested and debugged?
> Can API changes be released without breaking production?

That is the mindset this whole series is trying to build.

---

## 31. Summary

Dalam capstone ini, kita menyatukan seluruh seri menjadi satu model desain library Java serius.

Inti pembelajaran:

1. **API publik adalah kontrak jangka panjang.** Buat kecil, jelas, immutable, dan sulit disalahgunakan.
2. **Internal implementation harus tersembunyi.** Gunakan package-private, internal package, dan JPMS export discipline.
3. **SPI adalah extension boundary.** Jangan membuat consumer/plugin bergantung pada internal descriptor.
4. **Annotation processing adalah compile-time validation.** Gunakan untuk menangkap kesalahan sebelum runtime.
5. **Generated code harus deterministic dan debuggable.** Jangan membuat generator menjadi black box.
6. **Reflection harus eksplisit dan terbatas.** JPMS `opens` harus dipakai secara sadar.
7. **ServiceLoader cocok untuk provider model.** Terutama jika extension perlu module-aware.
8. **Dependency governance menentukan kesehatan jangka panjang.** Pisahkan API, runtime, annotation, processor, testkit, BOM.
9. **Compatibility harus dipikirkan sejak awal.** Source compatibility, binary compatibility, behavioral compatibility, generated-code compatibility, dan SPI compatibility berbeda.
10. **Failure model harus didesain.** Compile-time error, startup error, runtime business denial, technical failure, dan operational issue harus dibedakan.

---

## 32. Referensi Resmi dan Bacaan Lanjutan

Referensi utama:

- Java Language Specification, Java SE 25 — terutama Chapter 8, 9, 13, dan bagian annotation/type system.
- Java SE 25 API documentation untuk `java.lang.reflect`, `java.lang.invoke`, `java.lang.module`, `java.util.ServiceLoader`, dan `java.compiler`.
- JEP 261 — Module System.
- Java SE 25 API `javax.annotation.processing`.
- Java SE 25 API `java.lang.reflect.Proxy` dan `InvocationHandler`.
- Java SE 25 API `ServiceLoader`.
- Java SE 25 API `java.lang.instrument`.
- Maven dependency mechanism documentation.
- Gradle dependency management, version catalog, platform, locking, and verification documentation.
- Semantic Versioning 2.0.0.

---

# Status Akhir Seri

Seri `learn-java-oop-functional-reflection-codegen-modules` **selesai** pada Part 030.

Daftar lengkap:

- Part 000 — Orientation: Mental Model Besar Java Program Structure
- Part 001 — Java Type System Deep Dive
- Part 002 — Class Anatomy
- Part 003 — Object Identity, Equality, Hashing, Immutability
- Part 004 — Encapsulation Beyond `private`
- Part 005 — Inheritance Deep Dive
- Part 006 — Interfaces Deep Dive
- Part 007 — Sealed Classes and Controlled Hierarchies
- Part 008 — Records Deep Dive
- Part 009 — Enums as Type-Safe State, Strategy, Registry, and Domain Model
- Part 010 — Nested, Inner, Local, and Anonymous Classes
- Part 011 — Generics for API Designers
- Part 012 — Advanced Polymorphism
- Part 013 — Composition, Delegation, Mixins, and Object Collaboration Design
- Part 014 — Functional Java Mental Model
- Part 015 — Lambdas Under the Hood
- Part 016 — Functional Interfaces and Higher-Order API Design
- Part 017 — Optional, Nullability, Result Modeling, and Error Channels
- Part 018 — Reflection Deep Dive I
- Part 019 — Reflection Deep Dive II
- Part 020 — MethodHandles and VarHandles
- Part 021 — Annotation Design
- Part 022 — Annotation Processing
- Part 023 — Code Generation Strategy
- Part 024 — Dynamic Proxy, Bytecode Libraries, Agents, and Instrumentation Concepts
- Part 025 — Package Architecture
- Part 026 — JPMS Deep Dive I
- Part 027 — JPMS Deep Dive II
- Part 028 — Maven/Gradle Dependency Governance
- Part 029 — API Evolution, Binary Compatibility, Semantic Versioning
- Part 030 — Capstone: Designing a Modular, Reflective, Generated-Code Friendly Java Library

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: API Evolution, Binary Compatibility, Semantic Versioning, and Library Design](./learn-java-oop-functional-reflection-codegen-modules-part-029.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 0 — Security Mental Model for Senior Java Engineers](../security/learn-java-security-cryptography-integrity-part-000.md)
