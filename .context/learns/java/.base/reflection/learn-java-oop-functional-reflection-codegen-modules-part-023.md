# learn-java-oop-functional-reflection-codegen-modules-part-023

# Code Generation Strategy: Source Generation, Runtime Generation, Bytecode Generation

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `023`  
> Topik: Java code generation strategy untuk engineer yang ingin memahami trade-off source generation, runtime generation, bytecode generation, schema-driven generation, ownership, debugging, compatibility, dan governance.

---

## 0. Tujuan Part Ini

Pada bagian sebelumnya kita sudah membahas annotation processing sebagai bentuk **compile-time metaprogramming**. Bagian ini memperluas pembahasan ke strategi code generation secara umum.

Targetnya bukan hanya tahu bahwa Java bisa menghasilkan kode, tetapi mampu menjawab pertanyaan seperti:

1. **Kapan code generation layak dipakai?**
2. **Apa yang harus digenerate: source, class/bytecode, metadata, adapter, atau registry?**
3. **Kapan reflection lebih baik daripada generated code?**
4. **Kapan annotation processor lebih baik daripada runtime proxy?**
5. **Bagaimana membuat generated code yang bisa di-debug, di-review, dan berevolusi?**
6. **Bagaimana mencegah generator menjadi “compiler buruk” yang menyembunyikan kompleksitas?**
7. **Apa dampak code generation terhadap API compatibility, JPMS, build reproducibility, observability, dan security?**

Mental model utamanya:

```text
Code generation is not magic.
It is a compiler-like transformation from one model to another artifact.

Input model  ->  generator  ->  output artifact  ->  compiler/runtime  ->  behavior
```

Generator yang baik membuat aturan eksplisit. Generator yang buruk menyembunyikan aturan sampai bug baru terlihat di runtime.

---

## 1. Apa Itu Code Generation?

Dalam konteks Java, code generation adalah proses membuat artifact program secara otomatis dari input tertentu.

Artifact yang dihasilkan bisa berupa:

| Output | Contoh |
|---|---|
| Java source file | `UserMapperImpl.java`, `OrderValidator.java` |
| `.class` bytecode | runtime-generated proxy class, enhanced entity class |
| Resource file | `META-INF/services/...`, JSON metadata, index file |
| Configuration | generated route map, generated module descriptor fragment |
| Test code | generated contract test, generated fixture builder |
| Documentation | generated API catalog, state transition table |

Input generator bisa berupa:

| Input | Contoh |
|---|---|
| Annotation | `@Mapper`, `@Entity`, `@Route`, `@UseCase` |
| Schema | OpenAPI, AsyncAPI, JSON Schema, XSD, protobuf, Avro |
| Database metadata | table/column/index/foreign key |
| Domain model | state machine definition, command/event model |
| DSL | YAML rules, custom declarative config |
| Reflection metadata | classpath scan result |
| Source AST | compiler tree, parser result |
| Bytecode | class enhancement/instrumentation |

Yang penting: **source code bukan satu-satunya source of truth**.

Dalam code generation, selalu ada pertanyaan governance:

```text
Apa source of truth-nya?
Siapa pemiliknya?
Bagaimana divalidasi?
Bagaimana versioning-nya?
Bagaimana output-nya dicek?
Bagaimana runtime behavior-nya diamati?
```

---

## 2. Mengapa Code Generation Dipakai?

Code generation biasanya muncul ketika ada pola yang:

1. **Berulang**
2. **Mekanis**
3. **Berbasis metadata/schema**
4. **Rawan human error**
5. **Harus konsisten lintas modul/service**
6. **Terlalu mahal jika dieksekusi via reflection setiap runtime**
7. **Butuh compile-time checking**

Contoh umum:

```text
DTO <-> domain mapper
entity metamodel
API client/server stub
validation adapter
serialization adapter
service registry
command dispatcher
state transition table
query DSL
protobuf/Avro class
OpenAPI client
```

Namun code generation tidak otomatis bagus. Kadang ia hanya memindahkan kompleksitas dari source code manual ke generator yang lebih sulit dipahami.

Rule awal:

```text
Generate code only when the generated artifact is more predictable,
more consistent, or more verifiable than handwritten code.
```

---

## 3. Tiga Keluarga Besar Code Generation di Java

Secara besar, strategi code generation di Java bisa dibagi menjadi tiga:

```text
1. Source generation
   -> menghasilkan .java
   -> dikompilasi normal oleh javac

2. Runtime generation
   -> menghasilkan class/object saat aplikasi berjalan
   -> biasanya proxy, adapter, invoker, serializer

3. Bytecode generation/enhancement
   -> menghasilkan atau memodifikasi .class
   -> build-time, load-time, atau runtime
```

Tabel perbandingan awal:

| Strategi | Waktu | Output | Kelebihan | Risiko |
|---|---:|---|---|---|
| Source generation | build-time | `.java` | mudah dibaca, compile-time error, IDE-friendly | build complexity, generated source noise |
| Runtime generation | runtime/startup | class/object | fleksibel, cocok untuk dynamic config | startup cost, harder debugging, runtime failure |
| Bytecode generation | build/load/runtime | `.class` | sangat powerful, bisa tanpa source | opaque, classloader risk, JPMS/access issue |

---

## 4. Source Generation

Source generation menghasilkan file `.java`, lalu file itu dikompilasi seperti source biasa.

Contoh:

```text
Input:
  @Mapper
  interface UserMapper { ... }

Generated:
  UserMapperImpl.java
```

Atau:

```text
Input:
  state-machine.yaml

Generated:
  CaseState.java
  CaseTransition.java
  CaseTransitionValidator.java
  CaseTransitionTable.md
```

### 4.1 Kelebihan Source Generation

Source generation sering menjadi strategi paling aman untuk sistem enterprise karena:

1. Output bisa dibaca manusia.
2. Output bisa di-debug dengan stack trace normal.
3. Compile error muncul saat build.
4. IDE dapat navigate ke generated source.
5. Generated code bisa diuji seperti code biasa.
6. Tidak butuh deep runtime reflection.
7. Lebih cocok dengan JPMS strong encapsulation dibanding runtime deep reflection.

Source generation cocok ketika output bersifat deterministik dan bisa diketahui saat build.

### 4.2 Kekurangan Source Generation

Risikonya:

1. Build menjadi lebih kompleks.
2. Error message generator bisa buruk.
3. Incremental compilation bisa sulit.
4. Generated source bisa membanjiri codebase.
5. Developer bisa mengedit generated file secara manual.
6. Output bisa berbeda antar environment jika generator tidak deterministic.
7. API generator bisa membuat surface area terlalu besar.

### 4.3 Contoh Source Generation Sederhana

Misalnya kita punya annotation:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.SOURCE)
public @interface GenerateFactory {
}
```

Class input:

```java
@GenerateFactory
public final class CustomerId {
    private final String value;

    private CustomerId(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("CustomerId must not be blank");
        }
        this.value = value;
    }

    public static CustomerId of(String value) {
        return new CustomerId(value);
    }
}
```

Generator dapat menghasilkan:

```java
public final class CustomerIdFactory {
    private CustomerIdFactory() {
    }

    public static CustomerId fromString(String value) {
        return CustomerId.of(value);
    }
}
```

Ini contoh trivial. Dalam sistem nyata, generated code bisa lebih kompleks: mapper, validator, registry, dispatcher, adapter.

### 4.4 Generated Code Sebaiknya Seperti Apa?

Generated source yang baik:

```java
@Generated(
    value = "com.acme.codegen.CaseTransitionGenerator",
    date = "2026-06-16T00:00:00Z",
    comments = "Source: case-state-machine.yaml; version: 7"
)
public final class GeneratedCaseTransitionTable {
    private GeneratedCaseTransitionTable() {
    }

    public static boolean canMove(CaseStatus from, CaseStatus to) {
        return switch (from) {
            case DRAFT -> to == CaseStatus.SUBMITTED;
            case SUBMITTED -> to == CaseStatus.UNDER_REVIEW || to == CaseStatus.REJECTED;
            case UNDER_REVIEW -> to == CaseStatus.APPROVED || to == CaseStatus.REJECTED;
            case APPROVED, REJECTED -> false;
        };
    }
}
```

Ciri baik:

1. Ada marker `@Generated`.
2. Ada informasi generator/version/source input.
3. Tidak bergantung pada urutan map/hash yang nondeterministic.
4. Output deterministic.
5. Error mudah dilacak ke input model.
6. Format readable.
7. Tidak mengandung secret/env-specific value.
8. Tidak perlu diedit manual.

---

## 5. Annotation Processor sebagai Source Generator

Annotation processing adalah salah satu cara paling umum melakukan source generation di Java.

Alurnya:

```text
javac starts
  -> scans source annotations
  -> invokes processors
  -> processors inspect Element/TypeMirror model
  -> processors create new source/resource using Filer
  -> javac compiles generated sources in later rounds
```

Contoh use case:

| Use case | Mengapa cocok |
|---|---|
| mapper implementation | input diketahui compile-time |
| DI metadata | bisa validasi dependency lebih awal |
| command handler registry | mencegah runtime scan mahal |
| query metamodel | compile-time property safety |
| validation adapter | annotation sebagai contract |

### 5.1 `Filer` dan Generated File

Dalam annotation processor, `Filer` bertugas membuat source/class/resource file. File yang dibuat processor diketahui oleh annotation processing tool dan source/class generated dapat diproses pada round berikutnya setelah writer/output stream ditutup.

Konsekuensinya:

```text
Generated file is part of compilation pipeline.
Do not treat it like random file output.
```

Prinsip:

1. Jangan overwrite file sembarangan.
2. Jangan generate file yang sama dari dua processor berbeda.
3. Jangan bergantung pada order processor jika tidak dikontrol.
4. Jangan membaca generated source dari lokasi filesystem manual jika bisa lewat model compiler.
5. Pastikan output ditutup agar bisa diproses round berikutnya.

### 5.2 Processor sebagai Compiler Kecil

Annotation processor yang baik melakukan empat hal:

```text
parse metadata
validate contract
build intermediate model
emit deterministic artifact
```

Contoh architecture:

```text
AnnotationProcessor
  -> ElementScanner
  -> ModelBuilder
  -> ModelValidator
  -> SourceRenderer
  -> FilerWriter
```

Jangan campur semuanya di satu class besar.

Buruk:

```java
process(...) {
    // scan annotation
    // string concat source
    // validate half-way
    // write file
    // log warning
    // parse options
    // infer package
    // handle errors
}
```

Lebih baik:

```java
public final class RouteProcessor extends AbstractProcessor {
    private RouteModelBuilder modelBuilder;
    private RouteModelValidator validator;
    private RouteSourceGenerator sourceGenerator;

    @Override
    public boolean process(Set<? extends TypeElement> annotations, RoundEnvironment roundEnv) {
        List<RouteModel> models = modelBuilder.build(roundEnv);
        ValidationReport report = validator.validate(models);
        report.emitTo(processingEnv.getMessager());

        if (report.hasErrors()) {
            return true;
        }

        sourceGenerator.generate(models, processingEnv.getFiler());
        return true;
    }
}
```

---

## 6. Schema-Driven Generation

Tidak semua generator berbasis annotation. Banyak sistem enterprise menggunakan schema sebagai source of truth.

Contoh:

| Schema | Generated output |
|---|---|
| OpenAPI | client, server interface, DTO |
| AsyncAPI | event publisher/subscriber contract |
| protobuf | message class, gRPC stub |
| Avro | event schema class |
| JSON Schema | DTO, validator |
| SQL schema | record/entity/query DSL |
| state machine DSL | transition validator, docs, tests |

### 6.1 Kekuatan Schema-Driven Generation

Kelebihan:

1. Contract lebih eksplisit.
2. Bisa dipakai lintas bahasa.
3. Bisa menjadi artifact governance antar team.
4. Bisa menghasilkan client/server/test/docs secara konsisten.
5. Bisa di-review oleh non-Java engineer.

### 6.2 Risiko Schema-Driven Generation

Risiko:

1. Schema tidak merepresentasikan semantic invariant.
2. Generated DTO dianggap domain model.
3. Breaking change schema tidak terdeteksi dengan baik.
4. Generator menghasilkan API Java yang buruk.
5. Customization terlalu banyak sampai generator sulit di-upgrade.
6. Generated code mengunci architecture ke tool tertentu.

### 6.3 Rule Penting

```text
A schema describes structure.
It rarely captures all business semantics.
```

Contoh:

```yaml
status:
  type: string
  enum: [DRAFT, SUBMITTED, APPROVED, REJECTED]
```

Schema ini tidak otomatis menjelaskan:

```text
DRAFT -> SUBMITTED allowed
SUBMITTED -> APPROVED allowed only by reviewer
APPROVED -> DRAFT forbidden
REJECTED -> SUBMITTED may need appeal window
```

Maka generated DTO tidak cukup. Anda tetap butuh domain policy:

```java
public final class CaseTransitionPolicy {
    public TransitionDecision evaluate(CaseSnapshot current, TransitionRequest request, UserContext actor) {
        // semantic rules live here
    }
}
```

---

## 7. Runtime Generation

Runtime generation membuat class/object saat aplikasi berjalan.

Contoh:

1. JDK dynamic proxy.
2. Runtime generated serializer.
3. Runtime generated mapper.
4. Runtime generated method accessor.
5. Runtime framework proxy.
6. Runtime plugin adapter.

### 7.1 JDK Dynamic Proxy

JDK dynamic proxy membuat object yang mengimplementasikan interface tertentu dan meneruskan invocation ke `InvocationHandler`.

Contoh:

```java
public interface CaseRepository {
    CaseRecord findById(CaseId id);
}
```

Proxy:

```java
CaseRepository repository = (CaseRepository) Proxy.newProxyInstance(
    CaseRepository.class.getClassLoader(),
    new Class<?>[] { CaseRepository.class },
    (proxy, method, args) -> {
        System.out.println("Invoking " + method.getName());
        return method.invoke(realRepository, args);
    }
);
```

Kegunaan:

1. Logging/interceptor.
2. Transaction boundary.
3. Security check.
4. Metrics.
5. Lazy client.
6. RPC stub.

Batasan:

1. Hanya interface-based.
2. Invocation via reflection-like path.
3. Stack trace bisa lebih sulit.
4. `equals`, `hashCode`, `toString` perlu ditangani sadar.
5. JPMS/package/module placement proxy perlu dipahami.

### 7.2 Runtime Generation vs Reflection

Reflection langsung:

```java
Method method = service.getClass().getMethod("approve", CaseId.class);
Object result = method.invoke(service, id);
```

Runtime generated invoker:

```java
CaseApproverInvoker invoker = generatedInvokerFactory.create(CaseService.class);
ApprovalResult result = invoker.approve(service, id);
```

Trade-off:

| Aspek | Reflection langsung | Runtime generated invoker |
|---|---|---|
| Simpel | tinggi | sedang/rendah |
| Startup | rendah | mungkin lebih tinggi |
| Per-call overhead | cenderung lebih tinggi | bisa lebih rendah |
| Debugging | cukup sulit | tergantung generated artifact |
| Type safety | rendah | bisa lebih tinggi |
| Failure time | runtime | runtime/startup |

### 7.3 Kapan Runtime Generation Cocok?

Cocok jika:

1. Contract baru diketahui saat runtime.
2. Plugin bisa dipasang tanpa recompile aplikasi utama.
3. Butuh dynamic proxy/interceptor.
4. Classpath/module path bervariasi antar deployment.
5. Biaya reflection per-call terlalu tinggi dan metadata bisa dikompilasi ke invoker.
6. Framework harus mendukung class yang tidak dikontrol framework.

Tidak cocok jika:

1. Semua input diketahui saat build.
2. Error seharusnya ditemukan di CI.
3. Aplikasi butuh startup sangat predictable.
4. Debugging harus sangat transparan.
5. Environment membatasi dynamic class generation.

---

## 8. Bytecode Generation

Bytecode generation menghasilkan `.class` langsung, tanpa menulis source Java terlebih dahulu.

Bisa terjadi:

```text
build-time
  -> generate .class before packaging

runtime
  -> define class during application startup/running

load-time
  -> transform class when loaded by classloader

agent-time
  -> Java agent transforms classes for monitoring/profiling/etc.
```

### 8.1 Mengapa Bytecode Generation Dipakai?

Bytecode generation dipakai ketika source generation tidak cukup:

1. Butuh subclass/proxy runtime.
2. Butuh intercept method tanpa source.
3. Butuh optimize dynamic access.
4. Butuh instrumentasi observability/profiling/coverage.
5. Butuh adaptasi terhadap class yang tidak bisa dimodifikasi.
6. Butuh runtime class shape yang bergantung config/plugin.

### 8.2 Risiko Bytecode Generation

Risikonya tinggi:

1. Output sulit dibaca.
2. Stack trace bisa opaque.
3. Verifier error sulit dipahami.
4. Classloader leak.
5. JPMS access issue.
6. Compatibility dengan JDK baru.
7. Tooling/debugger behavior tidak selalu nyaman.
8. Security review lebih sulit.
9. Startup overhead.
10. Runtime failure lebih fatal.

Bytecode generation harus dianggap seperti menulis compiler backend.

### 8.3 Byte Buddy sebagai Contoh Library

Byte Buddy adalah library code generation/manipulation untuk membuat dan memodifikasi class Java saat runtime tanpa compiler. Dibanding JDK proxy yang terbatas pada interface, Byte Buddy dapat membuat arbitrary classes.

Contoh konseptual:

```java
Class<?> dynamicType = new ByteBuddy()
    .subclass(Object.class)
    .name("com.acme.GeneratedType")
    .make()
    .load(getClass().getClassLoader())
    .getLoaded();
```

Gunakan library seperti ini hanya ketika benefit-nya jelas. Untuk banyak kasus enterprise biasa, source generation atau explicit composition lebih mudah di-maintain.

---

## 9. Java Agents dan Instrumentation

`java.lang.instrument` menyediakan service untuk Java agents agar dapat melakukan instrumentasi program yang berjalan di JVM. Mekanismenya melibatkan modifikasi bytecode method.

Contoh use case:

1. Profiling.
2. Coverage analyzer.
3. Monitoring agent.
4. Distributed tracing.
5. Security agent.
6. Performance diagnostics.

Mental model:

```text
Application bytecode
  -> class loading
  -> transformer/agent sees class bytes
  -> transformed class bytes
  -> JVM defines transformed class
```

### 9.1 Instrumentation Berbeda dari Business Code Generation

Instrumentation biasanya tidak boleh mengubah semantic bisnis.

Idealnya:

```text
observability agent adds observation,
not business behavior.
```

Jika agent mengubah behavior bisnis, debugging dan compliance akan jauh lebih sulit.

### 9.2 Risiko Agent

Risiko:

1. Agent conflict.
2. Class transformation order issue.
3. Startup failure.
4. Performance overhead.
5. Incompatible JDK/module access.
6. Hidden production behavior.
7. Difficult rollback.
8. Security review complexity.

Dalam sistem regulated, agent harus diperlakukan sebagai bagian dari runtime architecture, bukan sekadar tools tambahan.

---

## 10. Template-Based Generation vs Model-Based Generation

Banyak generator awal ditulis dengan string concatenation:

```java
String source = "public class " + name + " {\n" +
                "  public String value() { return \"" + value + "\"; }\n" +
                "}\n";
```

Ini cepat, tapi rapuh.

### 10.1 Template-Based Generation

Template-based generation memakai template:

```text
public final class {{className}} {
    private {{className}}() {}

    public static final String NAME = "{{name}}";
}
```

Kelebihan:

1. Mudah dibaca.
2. Cocok untuk output besar.
3. Separasi struktur output dan logic generator.

Risiko:

1. Template bisa menjadi programming language buruk.
2. Conditional/loop kompleks membuat template sulit dibaca.
3. Escaping bug.
4. Formatting inconsistent.

### 10.2 Model-Based Generation

Model-based generation membangun intermediate model dulu:

```java
public record GeneratedClassModel(
    String packageName,
    String simpleName,
    List<GeneratedMethodModel> methods
) {
}
```

Lalu model divalidasi:

```java
public final class GeneratedClassValidator {
    public void validate(GeneratedClassModel model) {
        requireValidPackage(model.packageName());
        requireValidJavaIdentifier(model.simpleName());
        requireNoDuplicateMethods(model.methods());
    }
}
```

Baru dirender:

```java
public final class JavaSourceRenderer {
    public String render(GeneratedClassModel model) {
        // deterministic rendering
    }
}
```

Kelebihan:

1. Validasi lebih mudah.
2. Unit test lebih jelas.
3. Bisa menghasilkan banyak target: source, docs, metadata.
4. Bisa menjaga deterministic ordering.
5. Bisa mencegah invalid Java lebih awal.

Rule:

```text
For serious generators, build an intermediate model.
Do not render directly from raw annotations/schema.
```

---

## 11. Generator sebagai Compiler

Generator yang serius punya pipeline seperti compiler:

```text
Input
  -> Parse
  -> Normalize
  -> Validate
  -> Build IR/intermediate model
  -> Analyze
  -> Emit artifact
  -> Verify artifact
```

Contoh untuk state machine generator:

```text
case-state-machine.yaml
  -> parse YAML
  -> normalize state names
  -> validate no unknown target states
  -> validate no duplicate transitions
  -> validate terminal state rules
  -> build TransitionGraph
  -> generate Java transition policy
  -> generate test cases
  -> generate Markdown transition table
```

Ini jauh lebih baik daripada:

```text
read yaml -> string concat Java file
```

### 11.1 Intermediate Representation / IR

IR adalah model internal yang stabil.

Contoh:

```java
public record StateMachineModel(
    String name,
    Set<StateModel> states,
    Set<TransitionModel> transitions
) {
}

public record StateModel(
    String code,
    boolean terminal
) {
}

public record TransitionModel(
    String from,
    String to,
    String action,
    Set<String> requiredRoles
) {
}
```

Dari IR yang sama, generator bisa membuat:

1. Java enum/sealed type.
2. Transition validator.
3. Unit tests.
4. Markdown docs.
5. JSON metadata for UI.
6. Audit event mapping.

Ini powerful karena semua output konsisten dari satu model.

### 11.2 Validation Harus Lebih Ketat dari Runtime

Generator sebaiknya menolak input buruk seawal mungkin.

Contoh validation:

```text
- duplicate state code
- unknown target state
- unreachable state
- transition from terminal state
- missing actor role
- invalid transition action name
- generated class name collision
- package name conflict
- reserved Java keyword
```

Dalam sistem besar, compile-time generator error jauh lebih murah daripada runtime production bug.

---

## 12. Generated Code Ownership

Pertanyaan penting:

```text
Apakah generated code boleh diedit manual?
```

Biasanya jawabannya: **tidak**.

Tiga pola ownership:

| Pola | Penjelasan | Cocok untuk |
|---|---|---|
| Fully generated | file selalu overwrite dari source of truth | DTO/stub/registry |
| Generated base + handwritten subclass | generated superclass, manual subclass extend | framework/template pattern |
| Handwritten base + generated implementation | interface manual, implementation generated | mapper/repository/proxy |

### 12.1 Fully Generated

```text
schema.yaml -> GeneratedApiClient.java
```

Jangan edit output. Edit schema/config/generator.

### 12.2 Generated Base + Handwritten Extension

```java
public abstract class GeneratedCaseWorkflowBase {
    protected abstract void onApproved(CaseId id);
}

public final class CaseWorkflow extends GeneratedCaseWorkflowBase {
    @Override
    protected void onApproved(CaseId id) {
        // manual business behavior
    }
}
```

Risiko: generated base menjadi inheritance trap.

### 12.3 Handwritten Contract + Generated Implementation

Ini sering paling sehat:

```java
public interface CaseMapper {
    CaseDto toDto(CaseAggregate aggregate);
}
```

Generated:

```java
public final class CaseMapperGenerated implements CaseMapper {
    @Override
    public CaseDto toDto(CaseAggregate aggregate) {
        // generated mapping
    }
}
```

Keuntungan:

1. Public contract tetap manual dan reviewed.
2. Implementation generated.
3. Test bisa assert against interface.
4. Refactoring lebih aman.

---

## 13. Generated Code Harus Masuk Git atau Tidak?

Tidak ada satu jawaban universal.

### 13.1 Jangan Commit Generated Code Jika

1. Generator selalu tersedia dalam build.
2. Output deterministic.
3. Build reproducible.
4. IDE/CI mudah menjalankan generator.
5. Generated output besar dan noisy.
6. Source of truth jelas.

### 13.2 Commit Generated Code Jika

1. Consumer tidak selalu punya generator.
2. Generator mahal/kompleks dijalankan.
3. Artifact perlu direview untuk compliance.
4. Generated output adalah public API artifact.
5. Build environment sulit distandardisasi.
6. Anda butuh diff eksplisit untuk contract changes.

### 13.3 Praktik Baik

Jika commit generated code:

```text
- beri header generated
- enforce no manual edits
- deterministic formatting
- CI check regenerate-no-diff
- review source-of-truth change, not hanya generated diff
```

Jika tidak commit:

```text
- generated directory jelas
- CI clean build wajib
- IDE setup documented
- generator version locked
- reproducibility tested
```

---

## 14. Determinism dan Reproducible Generation

Generated output harus deterministic.

Buruk:

```java
for (String key : hashMap.keySet()) {
    emit(key);
}
```

Karena order bisa tidak stabil.

Baik:

```java
hashMap.keySet().stream()
    .sorted()
    .forEach(this::emit);
```

Hindari output yang berubah tanpa perubahan input:

```text
timestamp current time
absolute machine path
random UUID
local username
environment-specific config
unordered reflection result
unordered filesystem traversal
locale-sensitive formatting
```

Jika timestamp diperlukan, gunakan source version atau build metadata yang controlled.

Rule:

```text
Same input + same generator version = same output.
```

---

## 15. Debugging Generated Code

Generated code yang tidak bisa di-debug akan dibenci developer.

### 15.1 Buat Stack Trace Informatif

Buruk:

```text
NullPointerException at GeneratedMapper.map(GeneratedMapper.java:4172)
```

Lebih baik:

```java
if (source.customer() == null) {
    throw new MappingException(
        "Cannot map CaseDto.customer: source customer is null. " +
        "Mapping rule: Case.customer -> CaseDto.customer"
    );
}
```

### 15.2 Generated Code Harus Readable

Walaupun mesin yang menulis, manusia tetap membaca saat incident.

Prinsip:

1. Format rapi.
2. Nama method jelas.
3. Method tidak terlalu panjang.
4. Komentar cukup untuk mapping source.
5. Line number meaningful.
6. Jangan minify Java generated code.

### 15.3 Source Mapping

Untuk generator dari schema/DSL, sertakan mapping:

```java
// Generated from case-state-machine.yaml:42
case SUBMITTED -> switch (action) {
    case "ASSIGN_REVIEWER" -> UNDER_REVIEW;
    case "REJECT" -> REJECTED;
    default -> throw unknownTransition(current, action);
};
```

Atau metadata:

```java
public static final String SOURCE_FILE = "case-state-machine.yaml";
public static final int SOURCE_VERSION = 7;
```

---

## 16. Testing Generator

Jangan hanya test generated code. Test generator juga.

Lapisan test:

| Test | Tujuan |
|---|---|
| Model builder test | input metadata menjadi IR benar |
| Validator test | input buruk ditolak |
| Renderer golden file test | output source sesuai snapshot |
| Compile test | generated source valid dikompilasi |
| Runtime behavior test | generated implementation berperilaku benar |
| Compatibility test | generated public API tidak breaking |

### 16.1 Golden File Test

Golden file test membandingkan output generator dengan expected file.

```text
input.yaml
expected/GeneratedCaseTransitionTable.java
```

Test:

```text
generate(input.yaml)
compare(normalizedOutput, expectedOutput)
```

Hati-hati: golden file test bisa terlalu brittle jika formatting sering berubah.

### 16.2 Compile Test

Generated source sebaiknya benar-benar dikompilasi di test.

Pipeline:

```text
input metadata
  -> generator
  -> generated .java
  -> javac compile
  -> load class
  -> execute behavior test
```

Ini menangkap bug yang tidak terlihat di string comparison.

---

## 17. Generated Code dan API Compatibility

Generated code dapat memperbesar public API tanpa sadar.

Contoh masalah:

```java
public final class GeneratedOrderClient {
    public GeneratedOrderClient(String baseUrl, String token, int timeout) { ... }
}
```

Jika generator berubah constructor signature, consumer break.

Lebih stabil:

```java
public interface OrderClient {
    OrderResponse getOrder(OrderId id);
}
```

Generated implementation:

```java
final class GeneratedOrderClient implements OrderClient {
    private final HttpTransport transport;

    GeneratedOrderClient(HttpTransport transport) {
        this.transport = transport;
    }
}
```

Public factory manual:

```java
public final class OrderClients {
    public static OrderClient create(OrderClientConfig config) {
        return new GeneratedOrderClient(HttpTransport.from(config));
    }
}
```

Rule:

```text
Keep generated public API small.
Prefer manual stable facade over generated implementation details.
```

---

## 18. Reflection vs Code Generation

Salah satu design decision paling umum:

```text
Should I use reflection or generate code?
```

### 18.1 Reflection Cocok Jika

1. Dynamic behavior memang dibutuhkan.
2. Jumlah invocation kecil.
3. Simplicity lebih penting daripada performance.
4. Class shape tidak diketahui saat build.
5. Framework extension harus sangat fleksibel.
6. Failure saat startup masih acceptable.

### 18.2 Code Generation Cocok Jika

1. Input diketahui saat build.
2. Runtime reflection overhead signifikan.
3. Error perlu ditemukan di CI.
4. Butuh type-safe implementation.
5. Butuh native-image friendliness.
6. Butuh dokumentasi/generated tests dari model yang sama.
7. Contract harus direview.

### 18.3 Hybrid Pattern

Banyak framework modern memakai hybrid:

```text
build-time scan/annotation processing
  -> generate metadata/index/invokers
runtime
  -> use generated metadata with little/no reflection
```

Contoh konseptual:

```java
public final class GeneratedHandlerRegistry {
    public static Map<Class<?>, HandlerInvoker<?>> handlers() {
        return Map.of(
            SubmitCaseCommand.class,
            new SubmitCaseHandlerInvoker(),
            ApproveCaseCommand.class,
            new ApproveCaseHandlerInvoker()
        );
    }
}
```

Keuntungan:

1. Startup lebih predictable.
2. Runtime scan berkurang.
3. Error lebih awal.
4. Observability lebih mudah.

---

## 19. Generated Code dan JPMS

JPMS membuat code generation lebih disiplin karena module boundary menjadi nyata.

Masalah umum:

```text
Generated code wants to access package-private/internal type from another module.
```

Itu seharusnya gagal.

### 19.1 Generator Harus Module-Aware

Pertanyaan:

1. Generated class ditempatkan di package mana?
2. Package tersebut diekspor atau internal?
3. Generated class perlu reflection access?
4. Module perlu `requires` apa?
5. Apakah butuh `opens` untuk framework?
6. Apakah generated service provider perlu `provides ... with`?

### 19.2 Generated Service Provider

Misalnya generator membuat provider untuk `ServiceLoader`:

```java
public final class GeneratedCaseRuleProvider implements CaseRuleProvider {
    @Override
    public List<CaseRule> rules() {
        return List.of(
            new EligibilityRule(),
            new EscalationRule()
        );
    }
}
```

Module descriptor:

```java
module com.acme.case.rules {
    requires com.acme.case.api;

    provides com.acme.case.api.CaseRuleProvider
        with com.acme.case.rules.GeneratedCaseRuleProvider;
}
```

Jika module descriptor juga generated/updated, governance harus jelas.

---

## 20. Generated Code dan Security

Generator adalah bagian dari supply chain.

Risiko:

1. Generator dependency compromised.
2. Schema input dari pihak tidak trusted.
3. Generated code mengandung injection bug.
4. Template escaping salah.
5. Generated source menulis secret ke file.
6. Generated code membuka reflective access terlalu luas.
7. Build plugin menjalankan arbitrary code.
8. Runtime bytecode generation melewati review.

### 20.1 Jangan Generate Secret

Buruk:

```java
public static final String API_TOKEN = "prod-secret-token";
```

Baik:

```java
public final class GeneratedClientConfigKeys {
    public static final String API_TOKEN_PROPERTY = "external.api.token";
}
```

Secret harus tetap dari runtime secret manager/config, bukan generated artifact.

### 20.2 Escape Semua Input

Jika schema/input bisa mengandung string bebas, jangan langsung inject ke Java source.

Buruk:

```java
emit("public static final String LABEL = \"" + label + "\";");
```

Jika `label` mengandung quote/newline/backslash, output rusak atau berbahaya.

Harus ada Java string literal escaping.

### 20.3 Validate Identifier

Input:

```yaml
name: "class"
```

Tidak boleh langsung menjadi:

```java
public final class class { }
```

Generator harus validate/reserved keyword handling.

---

## 21. Generated Code dan Observability

Generated code bisa membuat observability buruk jika semua terlihat sebagai `GeneratedInvoker.invoke`.

Buruk:

```text
metric: generated.invoke.count
span: GeneratedClient.call
error: Invocation failed
```

Lebih baik:

```text
metric: command.handler.invoke.count{command="ApproveCaseCommand", handler="ApproveCaseHandler"}
span: CaseCommandDispatcher/ApproveCaseCommand
error: Transition DENIED from SUBMITTED to APPROVED reason=MISSING_REVIEWER_ROLE
```

Generated code harus membawa semantic name dari input model.

Contoh:

```java
public final class GeneratedCommandDispatcher {
    public Object dispatch(Command command) {
        return switch (command) {
            case SubmitCaseCommand c -> observe("SubmitCaseCommand", () -> submitInvoker.invoke(c));
            case ApproveCaseCommand c -> observe("ApproveCaseCommand", () -> approveInvoker.invoke(c));
        };
    }
}
```

---

## 22. Generated Code dan Performance

Code generation sering dipakai demi performance, tetapi jangan asumsi tanpa ukur.

Performance dimension:

1. Build time.
2. Startup time.
3. Warmup/JIT behavior.
4. Allocation rate.
5. Per-call overhead.
6. Class loading cost.
7. Metaspace usage.
8. Cache locality.
9. Branch predictability.
10. Reflection/member lookup cost.

### 22.1 Generated Code Bisa Lebih Lambat

Generated code buruk:

```java
public Object map(Object source) {
    Map<String, Object> result = new HashMap<>();
    result.put("a", read(source, "a"));
    result.put("b", read(source, "b"));
    return result;
}
```

Manual typed code:

```java
public Target map(Source source) {
    return new Target(source.a(), source.b());
}
```

Generated code hanya cepat jika output-nya memang dekat dengan handwritten optimized code.

### 22.2 Startup vs Runtime Trade-Off

Runtime generation dapat memindahkan cost ke startup.

```text
startup:
  scan classes
  inspect annotations
  build model
  generate invokers
  define classes
  warm caches

runtime:
  faster dispatch
```

Untuk aplikasi CLI/serverless, startup cost mungkin lebih penting. Untuk long-running service high-throughput, runtime cost mungkin lebih penting.

---

## 23. Generated Code dan Native Image / AOT Thinking

Walau tidak membahas GraalVM secara mendalam di seri ini, penting memahami pola umum:

Reflection-heavy runtime discovery sering sulit untuk AOT/native image karena runtime metadata harus diketahui dan dikonfigurasi.

Generated code/build-time metadata biasanya lebih AOT-friendly.

Pattern:

```text
reflection scan at runtime
  -> harder for closed-world analysis

build-time generated registry
  -> easier to analyze
```

Contoh:

```java
public final class GeneratedJsonAdapters {
    public static JsonAdapter<?> adapterFor(Class<?> type) {
        if (type == CaseDto.class) return new CaseDtoJsonAdapter();
        if (type == UserDto.class) return new UserDtoJsonAdapter();
        throw new IllegalArgumentException("No adapter for " + type.getName());
    }
}
```

Ini lebih explicit daripada runtime scanning semua class.

---

## 24. Case Study: Generated State Machine untuk Regulatory Case Management

Misalnya domain:

```text
DRAFT
SUBMITTED
UNDER_REVIEW
APPROVED
REJECTED
CLOSED
```

Transitions:

```text
DRAFT -> SUBMITTED by applicant
SUBMITTED -> UNDER_REVIEW by officer
UNDER_REVIEW -> APPROVED by approver
UNDER_REVIEW -> REJECTED by approver
APPROVED -> CLOSED by system
REJECTED -> CLOSED by system
```

Source of truth:

```yaml
name: CaseWorkflow
states:
  - code: DRAFT
    terminal: false
  - code: SUBMITTED
    terminal: false
  - code: UNDER_REVIEW
    terminal: false
  - code: APPROVED
    terminal: false
  - code: REJECTED
    terminal: false
  - code: CLOSED
    terminal: true
transitions:
  - from: DRAFT
    to: SUBMITTED
    action: SUBMIT
    roles: [APPLICANT]
  - from: SUBMITTED
    to: UNDER_REVIEW
    action: ASSIGN_REVIEWER
    roles: [OFFICER]
  - from: UNDER_REVIEW
    to: APPROVED
    action: APPROVE
    roles: [APPROVER]
  - from: UNDER_REVIEW
    to: REJECTED
    action: REJECT
    roles: [APPROVER]
  - from: APPROVED
    to: CLOSED
    action: CLOSE
    roles: [SYSTEM]
  - from: REJECTED
    to: CLOSED
    action: CLOSE
    roles: [SYSTEM]
```

Generator pipeline:

```text
YAML parser
  -> StateMachineModel
  -> validation
      - no duplicate states
      - no unknown transition state
      - no transition from terminal state
      - no duplicate action for same source state
      - all non-terminal states have outgoing transition
  -> emit Java
      - CaseStatus enum
      - CaseAction enum
      - GeneratedCaseTransitionPolicy
      - GeneratedCaseWorkflowMetadata
  -> emit test
      - all configured transitions allowed
      - unknown transitions denied
  -> emit docs
      - transition matrix markdown
```

Generated enum:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED,
    CLOSED
}
```

Generated action:

```java
public enum CaseAction {
    SUBMIT,
    ASSIGN_REVIEWER,
    APPROVE,
    REJECT,
    CLOSE
}
```

Generated policy:

```java
public final class GeneratedCaseTransitionPolicy {
    private GeneratedCaseTransitionPolicy() {
    }

    public static TransitionDecision evaluate(
        CaseStatus from,
        CaseAction action,
        Set<Role> actorRoles
    ) {
        return switch (from) {
            case DRAFT -> switch (action) {
                case SUBMIT -> requireRole(actorRoles, Role.APPLICANT, CaseStatus.SUBMITTED);
                default -> TransitionDecision.denied("Action not allowed from DRAFT: " + action);
            };
            case SUBMITTED -> switch (action) {
                case ASSIGN_REVIEWER -> requireRole(actorRoles, Role.OFFICER, CaseStatus.UNDER_REVIEW);
                default -> TransitionDecision.denied("Action not allowed from SUBMITTED: " + action);
            };
            case UNDER_REVIEW -> switch (action) {
                case APPROVE -> requireRole(actorRoles, Role.APPROVER, CaseStatus.APPROVED);
                case REJECT -> requireRole(actorRoles, Role.APPROVER, CaseStatus.REJECTED);
                default -> TransitionDecision.denied("Action not allowed from UNDER_REVIEW: " + action);
            };
            case APPROVED -> switch (action) {
                case CLOSE -> requireRole(actorRoles, Role.SYSTEM, CaseStatus.CLOSED);
                default -> TransitionDecision.denied("Action not allowed from APPROVED: " + action);
            };
            case REJECTED -> switch (action) {
                case CLOSE -> requireRole(actorRoles, Role.SYSTEM, CaseStatus.CLOSED);
                default -> TransitionDecision.denied("Action not allowed from REJECTED: " + action);
            };
            case CLOSED -> TransitionDecision.denied("CLOSED is terminal");
        };
    }

    private static TransitionDecision requireRole(Set<Role> roles, Role required, CaseStatus target) {
        if (!roles.contains(required)) {
            return TransitionDecision.denied("Missing role: " + required);
        }
        return TransitionDecision.allowed(target);
    }
}
```

Manual domain service tetap mengontrol transaction, audit, side effect:

```java
public final class CaseWorkflowService {
    private final CaseRepository repository;
    private final AuditTrail auditTrail;

    public void perform(CaseId caseId, CaseAction action, Actor actor) {
        CaseAggregate aggregate = repository.get(caseId);

        TransitionDecision decision = GeneratedCaseTransitionPolicy.evaluate(
            aggregate.status(),
            action,
            actor.roles()
        );

        if (decision.isDenied()) {
            throw new InvalidCaseTransitionException(decision.reason());
        }

        aggregate.moveTo(decision.targetStatus());
        repository.save(aggregate);
        auditTrail.recordTransition(caseId, action, actor.id(), decision.targetStatus());
    }
}
```

Poin penting:

```text
Generated code handles mechanical transition table.
Manual code handles transaction, audit, authorization context, persistence, and side effects.
```

Jangan generate seluruh business service jika rule-nya butuh human reasoning dan change management tinggi.

---

## 25. Anti-Pattern Code Generation

### 25.1 Generator Menghasilkan God Class

Buruk:

```text
GeneratedApplication.java
  - routes
  - validation
  - database access
  - security
  - audit
  - mapping
  - transaction
  - error handling
```

Masalah:

1. Sulit di-debug.
2. Sulit diuji.
3. Semua perubahan menghasilkan diff besar.
4. Boundary hilang.
5. Generator menjadi framework tersembunyi.

### 25.2 Generated Code Mengandung Business Decision Kompleks

Jika business rule butuh diskusi BA/legal/compliance, hati-hati generate langsung dari config yang tidak tervalidasi kuat.

Generated rule boleh jika:

1. Source of truth formal.
2. Review process kuat.
3. Diff jelas.
4. Test generated.
5. Runtime observability jelas.

### 25.3 Generator Output Tidak Deterministic

Gejala:

```text
CI diff berubah terus
review noisy
cache invalidation buruk
build tidak reproducible
```

### 25.4 Generator Terlalu Banyak Magic

Gejala:

```text
developer tidak tahu class dari mana
stack trace menunjuk generated file yang tidak ada
IDE tidak bisa navigate
runtime behavior bergantung naming convention tersembunyi
```

### 25.5 Generated Public API Terlalu Besar

Gejala:

```text
ratusan generated public classes menjadi contract de facto
susah upgrade generator
consumer bergantung pada detail generated implementation
```

Solusi:

```text
manual facade + generated internal implementation
```

### 25.6 Generator Tidak Punya Test

Generator tanpa test sama seperti compiler tanpa test suite.

---

## 26. Design Matrix: Pilih Strategi yang Mana?

| Situasi | Strategi paling masuk akal |
|---|---|
| Mapping DTO-domain diketahui saat compile | source generation / annotation processor |
| Runtime plugin interface | ServiceLoader + runtime composition |
| Interface-based cross-cutting proxy | JDK dynamic proxy |
| Class-based proxy/AOP/lazy entity | bytecode generation library |
| Observability/profiling | Java agent/instrumentation |
| Schema API lintas bahasa | schema-driven source generation |
| High-throughput serializer | generated adapter/source/bytecode |
| Low-volume admin tool | reflection cukup |
| State machine formal | schema/DSL -> generated policy + docs + tests |
| DI metadata untuk fast startup | build-time index/source generation |
| Public client SDK | generated internal + manual stable facade |

---

## 27. Practical Checklist Sebelum Membuat Generator

Sebelum membuat generator, jawab:

```text
1. Apa source of truth-nya?
2. Apakah source of truth itu lebih stabil daripada generated code?
3. Apakah output deterministic?
4. Apakah generated output perlu masuk Git?
5. Bagaimana generated output diuji?
6. Apakah generated output public API?
7. Bagaimana compatibility dijaga?
8. Bagaimana developer debug stack trace?
9. Bagaimana error generator menjelaskan input yang salah?
10. Apakah generator butuh reflection/deep access?
11. Bagaimana impact JPMS/package boundary?
12. Apakah generator aman terhadap malicious input?
13. Apakah generator version dikunci?
14. Apakah CI mengecek regenerate-no-diff?
15. Apakah manual extension point jelas?
```

---

## 28. Code Review Checklist untuk Generated Code Strategy

Saat review PR yang menambahkan generator:

```text
[ ] Source of truth jelas
[ ] Output deterministic
[ ] Generated path jelas
[ ] Header @Generated ada
[ ] Tidak ada secret/env-specific value
[ ] Identifier/string escaping aman
[ ] Input validation kuat
[ ] Error message menunjuk source input
[ ] Generated API minimal
[ ] Manual facade tersedia bila public API
[ ] Test generator ada
[ ] Test generated behavior ada
[ ] Compile test ada
[ ] CI clean build menjalankan generator
[ ] Incremental build tidak rusak
[ ] JPMS/package boundary jelas
[ ] Observability semantic name ada
[ ] Upgrade path generator jelas
[ ] Documentation tersedia
```

---

## 29. Mental Model Final

Code generation adalah alat untuk mengubah repetisi mekanis menjadi artifact konsisten.

Namun generator yang baik bukan sekadar string builder. Generator yang baik adalah compiler kecil:

```text
input contract
  -> parse
  -> normalize
  -> validate
  -> model
  -> emit
  -> verify
```

Gunakan source generation jika input diketahui saat build dan developer perlu transparansi.

Gunakan runtime generation jika class/object shape memang baru diketahui saat runtime.

Gunakan bytecode generation jika Anda butuh power yang tidak bisa dicapai source/proxy biasa, dan siap membayar biaya complexity-nya.

Gunakan instrumentation untuk observability/profiling, bukan untuk menyembunyikan business behavior.

Prinsip top engineer:

```text
Generated code should reduce accidental complexity,
not hide essential complexity.
```

---

## 30. Ringkasan

Di bagian ini kita membahas:

1. Apa itu code generation.
2. Mengapa code generation dipakai.
3. Source generation, runtime generation, bytecode generation.
4. Annotation processor sebagai source generator.
5. Schema-driven generation.
6. Runtime proxy dan dynamic generation.
7. Bytecode generation dan Java agents.
8. Template-based vs model-based generation.
9. Generator sebagai compiler kecil.
10. Generated code ownership.
11. Commit vs tidak commit generated code.
12. Determinism dan reproducibility.
13. Debugging generated code.
14. Testing generator.
15. API compatibility.
16. Reflection vs code generation.
17. JPMS impact.
18. Security dan observability.
19. Performance trade-off.
20. Case study generated state machine.
21. Anti-pattern dan checklist.

Bagian berikutnya akan masuk ke area yang lebih low-level dan lebih berisiko: **dynamic proxy, bytecode libraries, agents, dan instrumentation concepts**.

---

## 31. Referensi

- Oracle Java SE 25 API — `javax.annotation.processing.Filer`.
- Oracle Java SE 25 API — `java.lang.reflect.Proxy`.
- Oracle Java SE 25 API — `java.lang.instrument` package.
- Oracle Java SE 25 API — `java.lang.instrument.Instrumentation`.
- Byte Buddy official documentation.
- Java Language Specification Java SE 25.
- Java Virtual Machine Specification Java SE 25.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-oop-functional-reflection-codegen-modules-part-022.md">⬅️ Annotation Processing: Compile-Time Metaprogramming</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-oop-functional-reflection-codegen-modules-part-024.md">Dynamic Proxy, Bytecode Libraries, Agents, and Instrumentation Concepts ➡️</a>
</div>
