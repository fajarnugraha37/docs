# learn-java-oop-functional-reflection-codegen-modules-part-022

# Annotation Processing: Compile-Time Metaprogramming

> Seri: **Java OOP, Functional, Reflection, Code Generation, Modules & Package Management**  
> Part: **022**  
> Topik: **Annotation Processing: Compile-Time Metaprogramming**

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas **annotation design**: bagaimana annotation menjadi metadata contract untuk compiler, framework, code generator, runtime scanner, atau documentation tooling.

Part ini melangkah satu level lebih dalam: **bagaimana annotation diproses saat compile-time**.

Annotation processing adalah salah satu mekanisme metaprogramming paling penting di ekosistem Java karena ia memungkinkan kita:

1. membaca struktur program saat kompilasi,
2. memvalidasi aturan arsitektur sebelum aplikasi berjalan,
3. menghasilkan source code tambahan,
4. menghasilkan metadata/resource,
5. mengurangi runtime reflection,
6. membuat framework lebih cepat, lebih type-safe, dan lebih eksplisit.

Mental model paling penting:

> Annotation processor adalah program yang berjalan di dalam proses kompilasi, membaca model source code melalui API compiler, lalu boleh menghasilkan source/resource baru atau melaporkan error/warning.

Ia bukan runtime reflection.
Ia bukan bytecode transformer.
Ia bukan macro seperti di C/C++.
Ia bukan AST rewriting umum seperti compiler plugin internal.
Ia adalah **compile-time model reader + validator + generator**.

---

## 1. Problem yang Dipecahkan Annotation Processing

Bayangkan kita memiliki annotation:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.SOURCE)
public @interface GenerateMapper {
    Class<?> target();
}
```

Lalu developer menulis:

```java
@GenerateMapper(target = CaseDto.class)
public record CaseEntity(
    String id,
    String status,
    String assignedOfficer
) {}
```

Kita ingin compiler menghasilkan:

```java
public final class CaseEntityToCaseDtoMapper {
    public CaseDto map(CaseEntity source) {
        return new CaseDto(
            source.id(),
            source.status(),
            source.assignedOfficer()
        );
    }
}
```

Tanpa annotation processing, opsi kita biasanya:

1. tulis mapper manual,
2. pakai reflection runtime,
3. pakai code generation eksternal,
4. pakai runtime proxy,
5. pakai framework magic.

Annotation processing memberi opsi keenam:

> biarkan developer menulis intent secara declarative, lalu compiler menghasilkan kode konkret yang type-safe.

Keuntungannya:

- error bisa muncul saat compile-time,
- generated code bisa dibaca,
- runtime lebih ringan,
- tidak perlu deep reflection,
- API generated dapat ikut di-type-check oleh compiler,
- module/package boundary bisa lebih eksplisit.

Kerugiannya:

- build menjadi lebih kompleks,
- debugging pindah ke fase compile-time,
- processor harus kompatibel dengan build tool,
- incremental build bisa terganggu,
- generator yang buruk bisa menghasilkan kode sulit dipahami,
- kesalahan desain annotation bisa terkunci lama.

---

## 2. Compile-Time vs Runtime Metaprogramming

### 2.1 Runtime Reflection

Runtime reflection bekerja saat aplikasi berjalan:

```java
Class<?> type = Class.forName("com.example.CaseEntity");
for (Method method : type.getDeclaredMethods()) {
    // inspect method at runtime
}
```

Kelebihan:

- fleksibel,
- bisa membaca class yang baru diketahui saat runtime,
- cocok untuk plugin/dynamic discovery.

Kekurangan:

- error sering muncul terlambat,
- butuh access opening di JPMS,
- lebih sulit dianalisis static,
- bisa mahal jika tidak dicache,
- rawan stringly typed.

### 2.2 Compile-Time Annotation Processing

Annotation processing bekerja saat kompilasi:

```java
@Override
public boolean process(
    Set<? extends TypeElement> annotations,
    RoundEnvironment roundEnv
) {
    for (Element element : roundEnv.getElementsAnnotatedWith(GenerateMapper.class)) {
        // inspect source model, validate, generate files
    }
    return true;
}
```

Kelebihan:

- error lebih awal,
- generated code ikut dikompilasi,
- tidak perlu runtime scanning,
- cocok untuk AOT-friendly design,
- bisa menjaga arsitektur sebelum aplikasi jalan.

Kekurangan:

- hanya melihat model yang tersedia saat compile,
- tidak boleh sembarang mutate existing source,
- lifecycle-nya berbasis rounds,
- butuh integrasi build yang benar,
- harus hati-hati dengan incremental compilation.

### 2.3 Bytecode Generation

Bytecode generation dapat terjadi saat build-time atau runtime:

- ASM,
- Byte Buddy,
- cglib,
- agent instrumentation,
- javassist,
- framework enhancement.

Annotation processing biasanya menghasilkan **source code**, bukan bytecode langsung.

Bisa saja processor menghasilkan resource atau source yang kemudian dikompilasi menjadi bytecode.
Namun processor yang langsung menulis `.class` biasanya jarang dan lebih sulit dikelola.

### 2.4 Mental Decision

| Kebutuhan | Cocoknya |
|---|---|
| Validasi penggunaan annotation | Annotation processor |
| Generate mapper/metadata/registry | Annotation processor |
| Runtime discovery plugin | Reflection/ServiceLoader |
| Intercept method call runtime | Proxy/bytecode/AOP |
| Modify existing class behavior | Bytecode instrumentation |
| Generate code dari schema | Source/code generator, bisa annotation processor |
| Enforce architecture rules saat build | Annotation processor atau static analysis |

---

## 3. Annotation Processor sebagai Mini Compiler

Processor yang baik sebaiknya dipikirkan seperti compiler kecil.

Compiler biasanya memiliki pipeline:

1. lexical/syntax parsing,
2. semantic analysis,
3. type checking,
4. intermediate model,
5. code generation,
6. diagnostics.

Annotation processor punya versi sederhana:

1. baca annotated elements,
2. validasi element kind dan type,
3. bangun model internal,
4. generate source/resource,
5. laporkan error/warning/note.

Jangan langsung generate string dari `Element` mentah tanpa model internal.

Anti-pattern:

```java
for (Element e : roundEnv.getElementsAnnotatedWith(MyAnnotation.class)) {
    writer.write("public class " + e.getSimpleName() + "Generated {");
    // langsung concat semua detail dari element
}
```

Lebih sehat:

```java
record MapperModel(
    String packageName,
    String sourceType,
    String targetType,
    List<PropertyMapping> mappings
) {}

record PropertyMapping(
    String sourceAccessor,
    String targetParameter,
    String type
) {}
```

Lalu generator bekerja dari `MapperModel`, bukan langsung dari compiler API.

Alasannya:

- lebih testable,
- validasi lebih jelas,
- generator tidak terlalu coupled ke `javax.lang.model`,
- error message lebih mudah dibuat,
- future extension lebih mudah.

---

## 4. API Utama Annotation Processing

Annotation processing berada terutama di package:

```java
javax.annotation.processing
javax.lang.model
javax.tools
```

Walaupun namanya masih `javax`, ini bagian dari Java SE module `java.compiler`.

### 4.1 `Processor`

`Processor` adalah interface dasar.

Biasanya kita tidak implement langsung, tetapi extend `AbstractProcessor`.

```java
public interface Processor {
    Set<String> getSupportedOptions();
    Set<String> getSupportedAnnotationTypes();
    SourceVersion getSupportedSourceVersion();

    void init(ProcessingEnvironment processingEnv);

    boolean process(
        Set<? extends TypeElement> annotations,
        RoundEnvironment roundEnv
    );
}
```

### 4.2 `AbstractProcessor`

`AbstractProcessor` menyediakan default behavior dan field:

```java
protected ProcessingEnvironment processingEnv;
```

Umumnya processor dibuat seperti:

```java
@SupportedAnnotationTypes("com.example.GenerateMapper")
@SupportedSourceVersion(SourceVersion.RELEASE_25)
public final class GenerateMapperProcessor extends AbstractProcessor {
    @Override
    public boolean process(
        Set<? extends TypeElement> annotations,
        RoundEnvironment roundEnv
    ) {
        return false;
    }
}
```

Namun untuk source version, banyak processor modern lebih memilih override:

```java
@Override
public SourceVersion getSupportedSourceVersion() {
    return SourceVersion.latestSupported();
}
```

Ini membantu processor tetap jalan di JDK baru, walau tetap perlu test compatibility.

### 4.3 `ProcessingEnvironment`

`ProcessingEnvironment` adalah akses processor ke fasilitas compiler:

```java
Types types = processingEnv.getTypeUtils();
Elements elements = processingEnv.getElementUtils();
Filer filer = processingEnv.getFiler();
Messager messager = processingEnv.getMessager();
Map<String, String> options = processingEnv.getOptions();
```

Ia menyediakan:

- `Elements`: utility untuk symbol/element,
- `Types`: utility untuk type relationship,
- `Filer`: menulis source/resource/class file,
- `Messager`: diagnostic message,
- options dari compiler/build tool,
- locale/source version.

### 4.4 `RoundEnvironment`

`RoundEnvironment` merepresentasikan satu round annotation processing.

```java
Set<? extends Element> elements =
    roundEnv.getElementsAnnotatedWith(GenerateMapper.class);
```

Method penting:

```java
roundEnv.processingOver()
roundEnv.errorRaised()
roundEnv.getRootElements()
roundEnv.getElementsAnnotatedWith(...)
```

Model rounds penting karena generated source dari satu round dapat ikut diproses pada round berikutnya.

### 4.5 `Element`

`Element` merepresentasikan program element:

- package,
- module,
- class,
- interface,
- record,
- enum,
- method,
- constructor,
- field,
- parameter,
- type parameter.

Contoh:

```java
ElementKind kind = element.getKind();
Name name = element.getSimpleName();
Set<Modifier> modifiers = element.getModifiers();
Element enclosing = element.getEnclosingElement();
List<? extends Element> enclosed = element.getEnclosedElements();
```

### 4.6 `TypeElement`

`TypeElement` merepresentasikan class/interface/enum/record declaration.

```java
TypeElement type = (TypeElement) element;
Name qualifiedName = type.getQualifiedName();
TypeMirror superclass = type.getSuperclass();
List<? extends TypeMirror> interfaces = type.getInterfaces();
```

Gunakan `TypeElement` ketika yang diproses adalah type declaration.

### 4.7 `ExecutableElement`

`ExecutableElement` merepresentasikan method atau constructor.

```java
ExecutableElement method = (ExecutableElement) element;
List<? extends VariableElement> params = method.getParameters();
TypeMirror returnType = method.getReturnType();
```

### 4.8 `VariableElement`

`VariableElement` merepresentasikan field, parameter, local variable tertentu, enum constant.

```java
VariableElement field = (VariableElement) element;
TypeMirror type = field.asType();
Object constantValue = field.getConstantValue();
```

### 4.9 `TypeMirror`

`TypeMirror` merepresentasikan type dalam compiler model:

- declared type,
- primitive type,
- array type,
- type variable,
- wildcard type,
- executable type,
- no type,
- null type,
- error type.

Jangan menganggap `TypeMirror.toString()` cukup untuk semantic logic.

Gunakan `Types`:

```java
boolean assignable = types.isAssignable(sourceType, targetType);
boolean same = types.isSameType(a, b);
boolean subtype = types.isSubtype(a, b);
TypeMirror erased = types.erasure(type);
```

---

## 5. Round-Based Processing Mental Model

Annotation processing tidak berjalan sekali saja.

Ia berjalan dalam beberapa round.

Model sederhananya:

1. Compiler mulai dari source awal.
2. Processor menemukan annotation.
3. Processor menghasilkan source/resource.
4. Compiler memasukkan generated source ke round berikutnya.
5. Processor bisa memproses generated source juga.
6. Proses berlanjut sampai tidak ada source baru.
7. Final round berjalan dengan `processingOver() == true`.

Pseudo-flow:

```text
Round 1:
  input: developer source
  processor: reads @GenerateMapper
  output: CaseMapper.java

Round 2:
  input: CaseMapper.java + prior symbols
  processor: maybe reads annotations in generated source
  output: maybe more files

Final Round:
  processingOver = true
  no more generated source compiled after this
```

Prinsip penting:

> Jangan generate file yang sama lebih dari sekali dalam rounds berbeda.

Jika processor menulis file yang sama dua kali, biasanya akan terjadi `FilerException`.

Contoh buruk:

```java
@Override
public boolean process(Set<? extends TypeElement> annotations, RoundEnvironment roundEnv) {
    generateRegistry(); // dilakukan setiap round
    return false;
}
```

Lebih benar:

```java
private boolean registryGenerated;

@Override
public boolean process(Set<? extends TypeElement> annotations, RoundEnvironment roundEnv) {
    if (roundEnv.processingOver()) {
        if (!registryGenerated) {
            generateRegistry();
            registryGenerated = true;
        }
    }
    return false;
}
```

Namun hati-hati: generating source pada final round tidak akan memicu round kompilasi berikutnya. Untuk source generation, biasanya generate sebelum final round. Untuk resource aggregate, final round sering masuk akal.

Pattern umum:

- per-type generated source: generate saat element ditemukan,
- aggregate metadata/resource: kumpulkan sepanjang rounds, tulis menjelang akhir,
- aggregate source: tulis sebelum final round jika perlu ikut dikompilasi.

---

## 6. Claiming Annotation: Return `true` vs `false`

Method `process` mengembalikan boolean.

```java
@Override
public boolean process(
    Set<? extends TypeElement> annotations,
    RoundEnvironment roundEnv
) {
    return true;
}
```

Maknanya:

- `true`: processor ini mengklaim annotation tersebut; processor lain tidak perlu memproses annotation yang sama pada round itu.
- `false`: annotation tidak diklaim; processor lain masih boleh memprosesnya.

Guideline:

Return `true` jika annotation memang milik processor Anda dan tidak diharapkan diproses processor lain.

Return `false` jika annotation bersifat shared marker atau Anda hanya melakukan observasi.

Contoh:

```java
@SupportedAnnotationTypes("com.example.GenerateMapper")
public final class MapperProcessor extends AbstractProcessor {
    @Override
    public boolean process(Set<? extends TypeElement> annotations, RoundEnvironment roundEnv) {
        // process GenerateMapper exclusively
        return true;
    }
}
```

Untuk processor architecture lint yang membaca banyak annotation framework eksternal, sering lebih aman `false`.

---

## 7. Minimal Annotation Processor

Misal kita punya annotation:

```java
package com.example.codegen;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.SOURCE)
public @interface GenerateGreeting {
    String value() default "Hello";
}
```

Processor sederhana:

```java
package com.example.codegen.processor;

import com.example.codegen.GenerateGreeting;

import javax.annotation.processing.AbstractProcessor;
import javax.annotation.processing.Filer;
import javax.annotation.processing.Messager;
import javax.annotation.processing.ProcessingEnvironment;
import javax.annotation.processing.RoundEnvironment;
import javax.annotation.processing.SupportedAnnotationTypes;
import javax.annotation.processing.SupportedSourceVersion;
import javax.lang.model.SourceVersion;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.TypeElement;
import javax.tools.Diagnostic;
import javax.tools.JavaFileObject;
import java.io.IOException;
import java.io.Writer;
import java.util.Set;

@SupportedAnnotationTypes("com.example.codegen.GenerateGreeting")
@SupportedSourceVersion(SourceVersion.RELEASE_25)
public final class GenerateGreetingProcessor extends AbstractProcessor {

    private Messager messager;
    private Filer filer;

    @Override
    public synchronized void init(ProcessingEnvironment processingEnv) {
        super.init(processingEnv);
        this.messager = processingEnv.getMessager();
        this.filer = processingEnv.getFiler();
    }

    @Override
    public boolean process(
        Set<? extends TypeElement> annotations,
        RoundEnvironment roundEnv
    ) {
        if (roundEnv.processingOver()) {
            return true;
        }

        for (Element element : roundEnv.getElementsAnnotatedWith(GenerateGreeting.class)) {
            if (element.getKind() != ElementKind.CLASS && element.getKind() != ElementKind.RECORD) {
                messager.printMessage(
                    Diagnostic.Kind.ERROR,
                    "@GenerateGreeting can only be used on class or record",
                    element
                );
                continue;
            }

            TypeElement type = (TypeElement) element;
            GenerateGreeting annotation = type.getAnnotation(GenerateGreeting.class);
            generateGreetingClass(type, annotation.value());
        }

        return true;
    }

    private void generateGreetingClass(TypeElement sourceType, String greeting) {
        String packageName = processingEnv.getElementUtils()
            .getPackageOf(sourceType)
            .getQualifiedName()
            .toString();

        String sourceSimpleName = sourceType.getSimpleName().toString();
        String generatedSimpleName = sourceSimpleName + "Greeting";
        String generatedQualifiedName = packageName + "." + generatedSimpleName;

        try {
            JavaFileObject file = filer.createSourceFile(generatedQualifiedName, sourceType);
            try (Writer writer = file.openWriter()) {
                writer.write("package " + packageName + ";\n\n");
                writer.write("public final class " + generatedSimpleName + " {\n");
                writer.write("  private " + generatedSimpleName + "() {}\n\n");
                writer.write("  public static String message() {\n");
                writer.write("    return \"" + escapeJava(greeting) + ", " + sourceSimpleName + "\";\n");
                writer.write("  }\n");
                writer.write("}\n");
            }
        } catch (IOException ex) {
            messager.printMessage(
                Diagnostic.Kind.ERROR,
                "Failed to generate " + generatedQualifiedName + ": " + ex.getMessage(),
                sourceType
            );
        }
    }

    private static String escapeJava(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
```

Annotated type:

```java
package com.example.app;

import com.example.codegen.GenerateGreeting;

@GenerateGreeting("Welcome")
public record CaseRecord(String id) {}
```

Generated source:

```java
package com.example.app;

public final class CaseRecordGreeting {
  private CaseRecordGreeting() {}

  public static String message() {
    return "Welcome, CaseRecord";
  }
}
```

The generated code can be used by normal source after successful compilation depending on build lifecycle and IDE support.

---

## 8. Registering Processor with Service Provider Configuration

The compiler discovers processors via service provider mechanism unless processors are explicitly configured.

Traditional service file:

```text
META-INF/services/javax.annotation.processing.Processor
```

Content:

```text
com.example.codegen.processor.GenerateGreetingProcessor
```

Project layout:

```text
processor-module/
  src/main/java/
    com/example/codegen/processor/GenerateGreetingProcessor.java
  src/main/resources/
    META-INF/services/javax.annotation.processing.Processor
```

In modular Java, service declaration can also be expressed in `module-info.java`.

```java
module com.example.codegen.processor {
    requires java.compiler;
    requires com.example.codegen.annotations;

    provides javax.annotation.processing.Processor
        with com.example.codegen.processor.GenerateGreetingProcessor;
}
```

However, many build setups still rely on processor path and service file discovery.

Practical rule:

> Keep annotation API and processor implementation as separate artifacts.

Recommended structure:

```text
codegen-annotations/
  contains @GenerateMapper

codegen-processor/
  depends on codegen-annotations
  contains GenerateMapperProcessor

application/
  compileOnly/implementation depends on codegen-annotations
  annotationProcessor depends on codegen-processor
```

Why separate?

- application runtime may need annotation types but not processor,
- processor should not leak into runtime classpath,
- build dependency is different from runtime dependency,
- avoids accidental processor execution from normal classpath,
- supports stricter dependency governance.

---

## 9. Build Integration: Maven

For Maven, annotation processors should usually be declared on the compiler plugin processor path rather than normal runtime dependency.

Example with Maven Compiler Plugin:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-compiler-plugin</artifactId>
      <version>4.0.0-beta-3</version>
      <configuration>
        <release>25</release>
        <annotationProcessorPaths>
          <path>
            <groupId>com.example</groupId>
            <artifactId>codegen-processor</artifactId>
            <version>${project.version}</version>
          </path>
        </annotationProcessorPaths>
      </configuration>
    </plugin>
  </plugins>
</build>
```

With newer plugin versions, annotation processor dependencies can also be represented using processor dependency types. Always check plugin version behavior because Maven compiler plugin behavior evolves.

Important build principles:

1. Annotation API belongs in normal compile scope if source uses the annotations.
2. Processor implementation belongs in annotation processor path.
3. Generated sources should be visible to IDE and build.
4. Processor versions should be locked.
5. Avoid discovering arbitrary processors from classpath.

Security implication:

> Annotation processors execute arbitrary code during build.

Do not let unknown classpath dependencies auto-execute processors in high-control builds.

---

## 10. Build Integration: Gradle

For Gradle Java project:

```groovy
plugins {
    id 'java'
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

dependencies {
    compileOnly 'com.example:codegen-annotations:1.0.0'
    annotationProcessor 'com.example:codegen-processor:1.0.0'
}
```

Kotlin DSL:

```kotlin
plugins {
    java
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}

dependencies {
    compileOnly("com.example:codegen-annotations:1.0.0")
    annotationProcessor("com.example:codegen-processor:1.0.0")
}
```

Gradle separates annotation processor path from compile classpath via `annotationProcessor` configuration.

Important:

- processor should declare all required dependencies,
- generated source should be treated as build output,
- generated code should not usually be committed unless there is a strong reason,
- incremental build behavior depends on processor characteristics.

---

## 11. `Elements` and `Types`: Do Not Use Strings as Your Type System

Bad processor code often relies on `toString()`:

```java
if (field.asType().toString().equals("java.lang.String")) {
    // fragile
}
```

This is fragile because:

- generic types stringify differently,
- nested classes can be confusing,
- error types can appear,
- aliases/imports are irrelevant but output may vary,
- type erasure matters.

Better:

```java
TypeElement stringElement = elements.getTypeElement("java.lang.String");
TypeMirror stringType = stringElement.asType();

if (types.isSameType(field.asType(), stringType)) {
    // semantic check
}
```

For assignability:

```java
if (types.isAssignable(field.asType(), targetType)) {
    // source can be assigned to target
}
```

For subtype:

```java
if (types.isSubtype(candidateType, requiredSupertype)) {
    // candidate is subtype
}
```

For erasure:

```java
TypeMirror erased = types.erasure(field.asType());
```

Use string names only when generating source text, diagnostics, or stable symbolic references.

---

## 12. Reading Annotation Values Correctly

Simple annotation values can be read like:

```java
GenerateGreeting annotation = element.getAnnotation(GenerateGreeting.class);
String value = annotation.value();
```

But class-valued annotation members are tricky:

```java
public @interface GenerateMapper {
    Class<?> target();
}
```

Reading it directly may throw `MirroredTypeException` if the class is not loadable in processor runtime:

```java
try {
    Class<?> target = annotation.target();
} catch (MirroredTypeException ex) {
    TypeMirror targetType = ex.getTypeMirror();
}
```

Better, for robust processors, inspect `AnnotationMirror` instead of invoking annotation proxy methods directly.

Example utility approach:

```java
private Optional<TypeMirror> getClassValue(
    Element element,
    String annotationQualifiedName,
    String memberName
) {
    for (AnnotationMirror mirror : element.getAnnotationMirrors()) {
        Element annotationElement = mirror.getAnnotationType().asElement();
        if (!(annotationElement instanceof TypeElement typeElement)) {
            continue;
        }
        if (!typeElement.getQualifiedName().contentEquals(annotationQualifiedName)) {
            continue;
        }

        for (Map.Entry<? extends ExecutableElement, ? extends AnnotationValue> entry
            : mirror.getElementValues().entrySet()) {
            if (entry.getKey().getSimpleName().contentEquals(memberName)) {
                Object value = entry.getValue().getValue();
                if (value instanceof TypeMirror typeMirror) {
                    return Optional.of(typeMirror);
                }
            }
        }
    }
    return Optional.empty();
}
```

Why this matters:

- processor should not depend on loading application classes,
- processor runs in compiler environment,
- compile-time type model is not runtime class model,
- classpath/module-path can differ from runtime.

Mental rule:

> In annotation processors, prefer `Element` and `TypeMirror` over `Class<?>`.

---

## 13. Validation: The Most Valuable Feature

Many teams think annotation processing is mostly for code generation.
Actually, validation may be even more valuable.

Example annotation:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.SOURCE)
public @interface DomainStateMachine {
    String name();
}
```

Validation rules:

- only allowed on sealed interface,
- all permitted subclasses must be records,
- each state must have stable code,
- there must be no duplicate state code,
- transition method must return known result type,
- package must be under `.domain.state`,
- public API must not expose internal generated type.

Processor can fail compilation:

```java
messager.printMessage(
    Diagnostic.Kind.ERROR,
    "@DomainStateMachine must be used on a sealed interface",
    element
);
```

This is powerful because architecture rules become executable.

Instead of documenting:

> Please remember every state type must be immutable and have stable code.

You enforce:

```text
ERROR: State type DraftCase must be a record or final immutable class.
```

Good diagnostic messages should include:

1. what is wrong,
2. why it is wrong,
3. how to fix,
4. where it happened.

Bad:

```text
Invalid element
```

Good:

```text
@DomainStateMachine can only be placed on a sealed interface.
Found CLASS com.example.CaseState.
Fix: declare `public sealed interface CaseState permits ...` or remove the annotation.
```

---

## 14. `Messager`: Error, Warning, Note

`Messager` emits compiler diagnostics.

```java
messager.printMessage(Diagnostic.Kind.ERROR, "message", element);
messager.printMessage(Diagnostic.Kind.WARNING, "message", element);
messager.printMessage(Diagnostic.Kind.NOTE, "message", element);
```

Use levels carefully.

| Kind | Meaning |
|---|---|
| `ERROR` | Compilation should fail |
| `WARNING` | Suspicious but allowed |
| `MANDATORY_WARNING` | Warning that should not be suppressed by normal means |
| `NOTE` | Informational |
| `OTHER` | Tool-specific |

Guideline:

- Use `ERROR` for broken contract.
- Use `WARNING` for discouraged but backward-compatible usage.
- Use `NOTE` sparingly; noisy processors are hated.

Attach diagnostics to specific element when possible:

```java
messager.printMessage(
    Diagnostic.Kind.ERROR,
    "Missing no-arg constructor",
    typeElement
);
```

This helps IDEs highlight the right source location.

---

## 15. `Filer`: Generating Source and Resource

`Filer` creates files during processing.

Common methods:

```java
filer.createSourceFile("com.example.Generated", originatingElements...)
filer.createClassFile("com.example.GeneratedClass", originatingElements...)
filer.createResource(StandardLocation.CLASS_OUTPUT, "", "META-INF/my.idx", originatingElements...)
```

### 15.1 Originating Elements

Always pass originating elements:

```java
JavaFileObject file = filer.createSourceFile(
    generatedQualifiedName,
    sourceType
);
```

Why?

- build tools can track generated file dependency,
- incremental compilation can be more accurate,
- IDEs can associate generated code with source,
- diagnostics/debugging becomes clearer.

### 15.2 Generated Source Location

Build tools typically place generated source under directories such as:

```text
target/generated-sources/annotations
build/generated/sources/annotationProcessor/java/main
```

Do not hardcode these paths in processor.

Use `Filer`.

### 15.3 Do Not Overwrite Existing User Source

Processor should not generate into user source directory.

Processor should not overwrite user-maintained classes.

Generated class name should be deterministic and collision-resistant.

Bad naming:

```text
Mapper
Generated
Helper
```

Better:

```text
CaseEntity__GeneratedMapper
CaseStateMachine__TransitionIndex
Generated_CaseEntityMapper
```

Even better, use package conventions:

```text
com.example.case.generated.CaseEntityMapperGenerated
```

But consider whether generated package should access package-private members. If yes, generate into same package. If no, generate into `.generated` subpackage.

Trade-off:

| Generated location | Benefit | Risk |
|---|---|---|
| Same package | can access package-private members | pollutes package surface |
| `.generated` package | cleaner separation | cannot access package-private members |
| internal generated package | clearer boundary | public access may be needed |

---

## 16. Source Generation Style

Small generators can write strings manually.

For serious projects, use a structured source writer.

Options:

1. manual string writer,
2. template engine,
3. JavaPoet-like model builder,
4. custom AST/source model,
5. generated-code DSL.

Manual writer example:

```java
writer.write("public final class " + className + " {\n");
```

Risk:

- escaping bugs,
- formatting bugs,
- invalid imports,
- reserved keyword collisions,
- generic signature mistakes,
- annotation formatting issues.

Structured generator model:

```java
GeneratedClass generated = GeneratedClass.builder(packageName, simpleName)
    .addModifier("public")
    .addModifier("final")
    .addMethod(...)
    .build();
```

Better if your generator grows.

### 16.1 Generated Code Should Be Boring

Generated code should be:

- explicit,
- readable,
- deterministic,
- formatted consistently,
- easy to debug,
- stable across builds,
- not overly clever.

Bad generated code:

```java
public Object x(Object a){try{return ((A)a).b().c();}catch(Throwable t){throw new RuntimeException(t);}}
```

Better:

```java
public final class CaseMapperGenerated implements CaseMapper {
    @Override
    public CaseDto map(CaseEntity source) {
        Objects.requireNonNull(source, "source");
        return new CaseDto(
            source.id(),
            source.status(),
            source.assignedOfficer()
        );
    }
}
```

Generated code is part of the system.
Treat it as production code.

---

## 17. Example: Compile-Time Mapper Generator

We will design a small mapper generator.

### 17.1 Annotation

```java
package com.example.mapper;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.SOURCE)
public @interface GenerateMapper {
    Class<?> target();
}
```

### 17.2 Input Types

```java
package com.example.caseapp;

import com.example.mapper.GenerateMapper;

@GenerateMapper(target = CaseSummaryDto.class)
public record CaseEntity(
    String id,
    String status,
    String assignedOfficer
) {}
```

```java
package com.example.caseapp;

public record CaseSummaryDto(
    String id,
    String status,
    String assignedOfficer
) {}
```

### 17.3 Desired Output

```java
package com.example.caseapp;

import java.util.Objects;

public final class CaseEntityToCaseSummaryDtoMapperGenerated {
    private CaseEntityToCaseSummaryDtoMapperGenerated() {}

    public static CaseSummaryDto map(CaseEntity source) {
        Objects.requireNonNull(source, "source");
        return new CaseSummaryDto(
            source.id(),
            source.status(),
            source.assignedOfficer()
        );
    }
}
```

### 17.4 Processor Logic

Processor must:

1. find `@GenerateMapper`,
2. ensure source type is record,
3. get target type from annotation,
4. ensure target type is record,
5. compare record components by name/type,
6. generate mapper source.

### 17.5 Record Detection

```java
if (sourceType.getKind() != ElementKind.RECORD) {
    error("@GenerateMapper source must be a record", sourceType);
    return;
}
```

### 17.6 Record Components

Record components appear through element APIs depending on JDK model.
A simple approach is to inspect enclosed elements and find accessor methods.

Better approach in modern Java:

```java
List<? extends RecordComponentElement> components = sourceType.getRecordComponents();
```

Then:

```java
for (RecordComponentElement component : components) {
    Name name = component.getSimpleName();
    TypeMirror type = component.asType();
    ExecutableElement accessor = component.getAccessor();
}
```

### 17.7 Type Matching

```java
if (!types.isSameType(sourceComponent.asType(), targetComponent.asType())) {
    error(
        "Component type mismatch for `" + name + "`: source is "
            + sourceComponent.asType() + ", target is " + targetComponent.asType(),
        sourceComponent
    );
}
```

### 17.8 Build Internal Model

```java
record MapperModel(
    String packageName,
    String sourceSimpleName,
    String targetSimpleName,
    String generatedSimpleName,
    List<ComponentMapping> components
) {}

record ComponentMapping(
    String name,
    String accessor,
    String type
) {}
```

### 17.9 Generate from Model

```java
private void writeMapper(MapperModel model, TypeElement originatingElement) throws IOException {
    String qualifiedName = model.packageName() + "." + model.generatedSimpleName();
    JavaFileObject file = filer.createSourceFile(qualifiedName, originatingElement);

    try (Writer writer = file.openWriter()) {
        writer.write("package " + model.packageName() + ";\n\n");
        writer.write("import java.util.Objects;\n\n");
        writer.write("public final class " + model.generatedSimpleName() + " {\n");
        writer.write("  private " + model.generatedSimpleName() + "() {}\n\n");
        writer.write("  public static " + model.targetSimpleName() + " map(" + model.sourceSimpleName() + " source) {\n");
        writer.write("    Objects.requireNonNull(source, \"source\");\n");
        writer.write("    return new " + model.targetSimpleName() + "(\n");

        for (int i = 0; i < model.components().size(); i++) {
            ComponentMapping component = model.components().get(i);
            String suffix = i + 1 < model.components().size() ? "," : "";
            writer.write("      source." + component.accessor() + "()" + suffix + "\n");
        }

        writer.write("    );\n");
        writer.write("  }\n");
        writer.write("}\n");
    }
}
```

This is intentionally simple but demonstrates the processor pattern.

---

## 18. Incremental Compilation and Processor Categories

Annotation processors can slow builds.

The core issue:

> If a processor's output depends on many source files globally, a small source change may require rerunning a large part of compilation.

Two common categories:

### 18.1 Isolating Processor

An isolating processor generates output for each annotated element independently.

Example:

```text
@GenerateMapper CaseEntity -> CaseEntityMapperGenerated.java
@GenerateMapper UserEntity -> UserEntityMapperGenerated.java
```

Changing `CaseEntity` only affects `CaseEntityMapperGenerated`.

This is build-tool friendly.

### 18.2 Aggregating Processor

An aggregating processor generates one output from many inputs.

Example:

```text
All @DomainEvent classes -> DomainEventRegistryGenerated.java
```

Changing one event can affect registry output.

Aggregating processors are sometimes necessary but more expensive.

### 18.3 Design Guideline

Prefer isolating processors when possible.

Use aggregating processors only when the product is inherently global:

- registry,
- index,
- service descriptor,
- route table,
- state machine transition graph,
- metadata catalog.

Even then, minimize the global surface.

Example bad aggregate:

```text
Generate one giant ApplicationMetadata.java from every class in the app.
```

Better:

```text
Generate one metadata file per module or feature.
Generate final aggregate only where explicitly needed.
```

---

## 19. Processor Options

Processors can accept options from build tool.

Declare supported options:

```java
@Override
public Set<String> getSupportedOptions() {
    return Set.of(
        "mapper.generatedPackage",
        "mapper.failOnWarning"
    );
}
```

Read them:

```java
String generatedPackage = processingEnv.getOptions()
    .getOrDefault("mapper.generatedPackage", "");

boolean failOnWarning = Boolean.parseBoolean(
    processingEnv.getOptions().getOrDefault("mapper.failOnWarning", "false")
);
```

Maven:

```xml
<compilerArgs>
  <arg>-Amapper.generatedPackage=com.example.generated</arg>
  <arg>-Amapper.failOnWarning=true</arg>
</compilerArgs>
```

Gradle:

```groovy
compileJava {
    options.compilerArgs += [
        '-Amapper.generatedPackage=com.example.generated',
        '-Amapper.failOnWarning=true'
    ]
}
```

Guideline:

- options should be stable,
- document them,
- validate unknown/invalid values,
- avoid too many knobs,
- prefer annotation values for per-element config,
- prefer processor options for build-wide config.

---

## 20. Error Types and Incomplete Classpath

During annotation processing, compiler may encounter unresolved types.

They may appear as `ErrorType`.

This can happen if:

- dependency missing,
- generated type not available yet,
- processor order/round issue,
- IDE incremental build glitch,
- module path misconfigured.

Processor should handle error types gracefully.

Bad:

```java
TypeElement target = (TypeElement) types.asElement(typeMirror);
String name = target.getQualifiedName().toString(); // NPE or bad cast
```

Better:

```java
Element typeElement = types.asElement(typeMirror);
if (!(typeElement instanceof TypeElement target)) {
    messager.printMessage(
        Diagnostic.Kind.ERROR,
        "Cannot resolve target type: " + typeMirror,
        element
    );
    return;
}
```

Do not hide unresolved type issues.
Clear diagnostics help developers fix build configuration.

---

## 21. Processor Ordering and Inter-Processor Dependencies

Multiple processors may run in one compilation.

Example:

- Lombok-like processor modifies/generates members,
- MapStruct-like processor generates mappers,
- custom processor validates architecture,
- framework processor generates metadata.

Problems:

- processor A expects generated code from processor B,
- processor B has not generated yet,
- processor C reads source before modifications,
- IDE behavior differs from CLI build.

Annotation processing spec does not give you a robust high-level orchestration model between unrelated processors.

Guidelines:

1. Avoid depending on another processor's generated output in the same compilation if possible.
2. Split build modules if ordering matters.
3. Generate stable intermediate annotations/resources.
4. Keep processors idempotent across rounds.
5. Test with Maven/Gradle/IDE.

If processor A must consume output from processor B, safer architecture:

```text
module-a-source
  compile with processor B
  produces generated source/class/resource

module-b
  compile with processor A consuming module-a artifact
```

This introduces a real build boundary.

---

## 22. Annotation Processing with JPMS

JPMS introduces additional structure.

Key facts:

- annotation processor API lives in module `java.compiler`,
- processors often run as build-time tools,
- application module graph may differ from processor classpath,
- generated source must respect module boundaries,
- generated packages must be declared/exported/opened if used across modules.

Processor module descriptor example:

```java
module com.example.mapper.processor {
    requires java.compiler;
    requires com.example.mapper.annotations;

    provides javax.annotation.processing.Processor
        with com.example.mapper.processor.MapperProcessor;
}
```

Annotation module:

```java
module com.example.mapper.annotations {
    exports com.example.mapper;
}
```

Application module:

```java
module com.example.caseapp {
    requires com.example.mapper.annotations;
}
```

If generated code is in the same module/package, it becomes part of the module's compiled output.

If generated code needs to be used by another module, ensure the package is exported:

```java
module com.example.caseapp {
    exports com.example.caseapp.api;
    exports com.example.caseapp.generated; // only if public API needs it
}
```

But be careful:

> Generated implementation classes usually should not become public exported API unless intentionally designed.

Better:

```java
module com.example.caseapp {
    exports com.example.caseapp.api;
}
```

Generated implementation can stay in non-exported package and be used internally.

---

## 23. Annotation Processor vs JPMS Encapsulation

Annotation processors read source/compile model, not runtime private fields via reflection.

However, they still can see source elements available to compiler.

Important distinction:

- JPMS strong encapsulation is mainly runtime/link-time access control between modules.
- Annotation processing occurs during compilation, observing program structure via compiler APIs.
- Generated code must still obey Java access rules after generation.

If processor generates code in different package, it cannot access package-private members.

Example:

```java
package com.example.domain;

record CaseState(String code) {
    String internalCode() { return code; } // package-private
}
```

Generated in same package:

```java
package com.example.domain;

final class CaseStateGeneratedAccess {
    static String internal(CaseState state) {
        return state.internalCode(); // allowed
    }
}
```

Generated in different package:

```java
package com.example.domain.generated;

final class CaseStateGeneratedAccess {
    static String internal(CaseState state) {
        return state.internalCode(); // not allowed
    }
}
```

So generation package is not cosmetic. It defines access capability.

---

## 24. Annotation Processing for Architecture Enforcement

Annotation processors can enforce rules that normal tests often miss.

Example: regulatory case system.

Rules:

1. All command objects must be records.
2. Commands must be in `.application.command` package.
3. Commands must not depend on infrastructure package.
4. Commands must have stable `commandType`.
5. Command handlers must return `CommandResult`.
6. Handler must be package-private unless part of API.

Annotations:

```java
@Target(ElementType.RECORD_COMPONENT)
@Retention(RetentionPolicy.SOURCE)
public @interface StableCode {}
```

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.SOURCE)
public @interface CaseCommand {
    String value();
}
```

Processor rule:

```java
if (!type.getQualifiedName().toString().contains(".application.command.")) {
    error("@CaseCommand must be declared under .application.command package", type);
}
```

Dependency rule:

```java
for (RecordComponentElement component : type.getRecordComponents()) {
    String componentType = component.asType().toString();
    if (componentType.contains(".infrastructure.")) {
        error("Command must not depend on infrastructure type: " + componentType, component);
    }
}
```

Better dependency check should use package elements and `TypeMirror`, not raw string, but this illustrates the idea.

This shifts architecture governance from review-only to compile-time enforcement.

---

## 25. Annotation Processing for Metadata Indexing

Runtime classpath scanning is convenient but can be expensive and JPMS-hostile.

Annotation processor can generate index files.

Example input:

```java
@CaseEvent("CASE_APPROVED")
public record CaseApproved(String caseId) {}

@CaseEvent("CASE_REJECTED")
public record CaseRejected(String caseId, String reason) {}
```

Generated resource:

```text
META-INF/case-events.idx
com.example.caseapp.CaseApproved=CASE_APPROVED
com.example.caseapp.CaseRejected=CASE_REJECTED
```

Runtime loader:

```java
try (InputStream input = classLoader.getResourceAsStream("META-INF/case-events.idx")) {
    // read index, no classpath scanning needed
}
```

Benefits:

- faster startup,
- less reflection,
- deterministic list,
- works better with native/AOT-like constraints,
- easier audit trail of known event types.

Risks:

- index stale if build broken,
- duplicate entries across modules,
- classloader merging semantics,
- resource conflict if multiple processors write same resource path.

For multi-module systems, prefer module-local index:

```text
META-INF/case-events/com.example.caseapp.idx
```

Then aggregate at runtime or build-time.

---

## 26. Annotation Processing for Service Provider Files

JPMS and classic Java both support service provider discovery.

A processor can generate service descriptor files.

Example annotation:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.SOURCE)
public @interface AutoServiceProvider {
    Class<?> value();
}
```

Input:

```java
@AutoServiceProvider(CaseRuleProvider.class)
public final class EscalationRuleProvider implements CaseRuleProvider {
    // ...
}
```

Generated resource:

```text
META-INF/services/com.example.CaseRuleProvider
```

Content:

```text
com.example.EscalationRuleProvider
```

Runtime:

```java
ServiceLoader<CaseRuleProvider> loader = ServiceLoader.load(CaseRuleProvider.class);
```

This removes manual service file maintenance.

But in JPMS, service provider declaration can also live in `module-info.java`:

```java
provides com.example.CaseRuleProvider
    with com.example.EscalationRuleProvider;
```

Generating `module-info.java` is generally more sensitive and less common for application modules. Be cautious.

---

## 27. Annotation Processing for State Machine Models

This series often uses regulatory lifecycle/state machine examples.

Annotation processing is strong for validating finite models.

Example:

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.SOURCE)
public @interface CaseStateModel {
    String name();
}
```

```java
@CaseStateModel(name = "EnforcementCase")
public sealed interface EnforcementCaseState
    permits Draft, Submitted, UnderReview, Approved, Rejected, Closed {
}

public record Draft() implements EnforcementCaseState {}
public record Submitted() implements EnforcementCaseState {}
public record UnderReview() implements EnforcementCaseState {}
public record Approved() implements EnforcementCaseState {}
public record Rejected() implements EnforcementCaseState {}
public record Closed() implements EnforcementCaseState {}
```

Processor validations:

- annotated type must be sealed interface,
- permitted subclasses must be in same domain module,
- all permitted subclasses must be final/record/sealed,
- no state name duplicates,
- terminal states must be marked,
- state graph must not have unreachable state,
- every transition command must reference known source/target.

Generated output:

```java
public final class EnforcementCaseStateModelGenerated {
    public static Set<String> states() { ... }
    public static boolean canTransition(String from, String to) { ... }
    public static boolean isTerminal(String state) { ... }
}
```

This is powerful for regulatory systems because it makes lifecycle governance explicit and checkable.

---

## 28. Testing Annotation Processors

Annotation processors should be tested like compilers.

Test categories:

1. valid source compiles,
2. invalid source fails with expected error,
3. generated source matches expectation,
4. generated resource matches expectation,
5. multi-round behavior works,
6. incremental-like changes behave,
7. module-path/classpath scenarios work,
8. IDE/build tool behavior is acceptable.

### 28.1 In-Process Compiler Test

Java provides compiler API:

```java
JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
```

You can compile test source strings/files and assert diagnostics.

Conceptual test:

```java
CompilationResult result = compile(
    """
    package test;

    @GenerateGreeting
    public record CaseRecord(String id) {}
    """
);

assertThat(result.succeeded()).isTrue();
assertThat(result.generatedSource("test.CaseRecordGreeting"))
    .contains("public final class CaseRecordGreeting");
```

Many teams use helper libraries for compile-testing, but the principle is independent:

- feed source,
- run processor,
- inspect diagnostics/output.

### 28.2 Golden File Testing

Generated source can be compared to expected golden files.

Pros:

- easy to review generated output,
- detects accidental changes,
- improves generator stability.

Cons:

- brittle formatting diffs,
- can become noisy,
- requires update discipline.

Guideline:

- keep generated code deterministic,
- format consistently,
- compare semantic fragments if full golden files are too brittle.

### 28.3 Negative Tests

Negative tests are critical.

Example:

```java
@GenerateMapper(target = CaseDto.class)
public final class CaseEntity {
    // not record
}
```

Expected diagnostic:

```text
@GenerateMapper source must be a record
```

You should assert:

- compilation failed,
- error kind is `ERROR`,
- message contains meaningful phrase,
- error attaches to correct source line if possible.

---

## 29. Common Failure Modes

### 29.1 Processor Loads Application Classes

Bad:

```java
Class<?> target = annotation.target();
```

Why bad:

- class may not be compiled yet,
- processor classloader differs,
- module path differs,
- causes `MirroredTypeException`,
- breaks incremental/IDE builds.

Better:

```java
TypeMirror target = extractTargetTypeMirror(annotationMirror);
```

### 29.2 Writing Same File Twice

Bad:

```java
generate("com.example.Registry"); // every round
```

Fix:

- track generated names,
- generate once,
- design per-element generation,
- handle rounds carefully.

### 29.3 Non-Deterministic Output

Bad:

```java
for (Element e : hashSetOfElements) {
    writer.write(e.toString());
}
```

Output order may change.

Fix:

```java
elements.stream()
    .sorted(Comparator.comparing(e -> e.toString()))
    .forEach(...);
```

Deterministic output improves caching, review, reproducible builds.

### 29.4 Poor Diagnostics

Bad:

```text
Failed
```

Good:

```text
@GenerateMapper target record is missing component `assignedOfficer` required by source record CaseEntity.
```

### 29.5 Too Much Runtime Coupling

Bad generated code:

```java
Class.forName("...").getDeclaredMethod("...").invoke(...)
```

If processor can generate direct calls, prefer direct calls.

### 29.6 Processor Has Side Effects

Bad:

- calls network,
- reads current time for generated code,
- reads developer machine-specific paths,
- writes outside `Filer`,
- modifies source files,
- depends on environment variables without declared options.

Processor should be deterministic and build-cache friendly.

### 29.7 Generated Code Becomes Public API Accidentally

Bad:

```java
public class GeneratedInternalCaseWorkflowRegistry { ... }
```

Then other modules start depending on it.

Fix:

- package-private generated classes where possible,
- non-exported package,
- clear naming `internal`/`generated`,
- expose stable facade if needed.

---

## 30. Security and Supply Chain Considerations

Annotation processors execute during build.

This means a malicious processor can:

- read files,
- access environment variables,
- exfiltrate secrets if network available,
- alter generated code,
- inject backdoors,
- slow or break builds.

Practical rules:

1. Do not allow arbitrary classpath processor discovery in strict builds.
2. Pin processor versions.
3. Use dependency verification where available.
4. Separate processor path from runtime classpath.
5. Review generated source for sensitive processors.
6. Avoid processors from untrusted dependencies.
7. Run CI in restricted environment.
8. Do not expose production secrets to build jobs.

This is often overlooked.

A processor is not “just metadata tooling”.
It is executable code in your build pipeline.

---

## 31. Performance Model

Annotation processing affects compile-time, not runtime directly.

Main cost drivers:

- number of source files scanned,
- number of annotated elements,
- type relationship checks,
- generated file count,
- aggregate global analysis,
- file I/O,
- non-incremental behavior,
- processor dependencies initialization,
- repeated work across rounds.

Optimization principles:

1. Process only supported annotations.
2. Avoid scanning all root elements unless needed.
3. Cache type elements/type mirrors in the processor instance per compilation.
4. Use deterministic sets/maps.
5. Avoid expensive string generation if no output needed.
6. Generate only when content changes? Usually `Filer` controls output; do not bypass it.
7. Avoid global aggregate processors in huge modules.
8. Split huge modules if generated metadata is too broad.

Bad:

```java
for (Element root : roundEnv.getRootElements()) {
    recursivelyScanEverything(root);
}
```

Better:

```java
for (Element element : roundEnv.getElementsAnnotatedWith(MyAnnotation.class)) {
    processAnnotatedElement(element);
}
```

---

## 32. Annotation Processor Design Checklist

Before writing processor, answer these questions.

### 32.1 Purpose

- Is the processor for validation, generation, indexing, or registration?
- Could normal Java code solve this more simply?
- Could reflection solve it acceptably?
- Is compile-time enforcement worth build complexity?

### 32.2 Annotation API

- Is annotation retention appropriate?
- Is target appropriate?
- Are member names stable?
- Are default values safe?
- Are class-valued members handled via `TypeMirror`?
- Is annotation too coupled to framework internals?

### 32.3 Processor Behavior

- Is output deterministic?
- Is generated file naming collision-resistant?
- Are errors actionable?
- Does it handle rounds correctly?
- Does it avoid loading application classes?
- Does it avoid side effects?
- Does it pass originating elements to `Filer`?

### 32.4 Build Integration

- Is processor on annotation processor path?
- Is annotation API separate from processor implementation?
- Are versions pinned?
- Is IDE behavior tested?
- Does it support incremental build where possible?
- Does it work under Maven and Gradle if needed?

### 32.5 Architecture

- Does generated code stay internal unless intentionally public?
- Does it respect JPMS/package boundaries?
- Does it avoid cyclic dependencies?
- Does it avoid hiding business logic in generated code?
- Is generated code readable enough for debugging?

---

## 33. Practical Production Pattern: Annotation API + Processor + Runtime API

For serious libraries, use three artifacts.

```text
case-workflow-annotations
  @CaseStateModel
  @CaseTransition

case-workflow-processor
  validates model
  generates transition index/source/resource

case-workflow-runtime
  runtime APIs used by application
  StateMachine
  TransitionResult
  TransitionValidator
```

Application dependencies:

```text
compile/runtime:
  case-workflow-annotations
  case-workflow-runtime

annotationProcessor:
  case-workflow-processor
```

Generated code can depend on runtime API:

```java
public final class EnforcementCaseStateMachineGenerated
    implements StateMachine<EnforcementCaseState, CaseCommand> {
    // generated transition implementation
}
```

This separation gives:

- clean runtime classpath,
- clear build-time tooling,
- annotation stability,
- generated code using stable runtime contracts,
- better version governance.

---

## 34. Example Capstone Mini-Design: Case Transition Processor

### 34.1 Goal

We want compile-time validation and generated runtime transition metadata for a case lifecycle.

### 34.2 Annotation

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.SOURCE)
public @interface CaseWorkflow {
    String value();
}
```

```java
@Target(ElementType.RECORD_COMPONENT)
@Retention(RetentionPolicy.SOURCE)
public @interface StableCode {
}
```

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.SOURCE)
public @interface Transition {
    Class<?> from();
    Class<?> to();
    String command();
}
```

### 34.3 Domain Source

```java
@CaseWorkflow("ENFORCEMENT_CASE")
public sealed interface CaseState
    permits Draft, Submitted, UnderReview, Approved, Rejected, Closed {
}

public record Draft() implements CaseState {}
public record Submitted() implements CaseState {}
public record UnderReview() implements CaseState {}
public record Approved() implements CaseState {}
public record Rejected() implements CaseState {}
public record Closed() implements CaseState {}
```

```java
@Transition(from = Draft.class, to = Submitted.class, command = "SUBMIT")
public final class SubmitCaseTransition {}

@Transition(from = Submitted.class, to = UnderReview.class, command = "START_REVIEW")
public final class StartReviewTransition {}
```

### 34.4 Processor Validation

Rules:

- `@CaseWorkflow` must be sealed interface.
- All permitted states must be known.
- `@Transition.from` and `to` must be permitted states.
- Commands must be unique per source state.
- Terminal states must not have outgoing transitions unless explicitly allowed.
- Generated transition table must be deterministic.

### 34.5 Generated Runtime Index

```java
package com.example.caseapp.generated;

import java.util.Map;
import java.util.Set;

public final class CaseWorkflowIndexGenerated {
    private CaseWorkflowIndexGenerated() {}

    public static Set<String> states() {
        return Set.of(
            "Draft",
            "Submitted",
            "UnderReview",
            "Approved",
            "Rejected",
            "Closed"
        );
    }

    public static boolean canTransition(String from, String command) {
        return switch (from) {
            case "Draft" -> command.equals("SUBMIT");
            case "Submitted" -> command.equals("START_REVIEW");
            default -> false;
        };
    }
}
```

### 34.6 Why This Is Better Than Runtime Reflection

Runtime reflection approach:

- scan classes,
- inspect annotations,
- build graph at startup,
- fail at startup if invalid.

Annotation processing approach:

- validate graph at compile-time,
- generate deterministic index,
- runtime just loads normal class,
- invalid model never ships.

This is exactly the type of mechanism that separates “framework user” from “framework-level engineer”.

---

## 35. Anti-Patterns

### 35.1 Annotation Processor as Business Logic Engine

Bad:

- generator encodes complex business decisions,
- generated code changes business meaning invisibly,
- reviewers do not understand output.

Good:

- business rules remain visible in domain model/config,
- processor validates and materializes boilerplate,
- generated code is mechanical.

### 35.2 Magic Annotation with Too Many Meanings

Bad:

```java
@SmartEntity(
    repository = true,
    mapper = true,
    controller = true,
    audit = true,
    security = true,
    workflow = true
)
```

This becomes a hidden framework DSL.

Better:

- separate annotations by concern,
- keep each annotation's contract narrow,
- make generated artifacts explicit.

### 35.3 Processor That Requires Global Scan for Everything

Bad:

- every compile scans every class,
- one change invalidates all output,
- IDE becomes slow.

Better:

- annotated-element-driven processing,
- isolating outputs,
- explicit aggregate only where necessary.

### 35.4 Generated Code No One Can Debug

Bad:

- unreadable names,
- huge generated class,
- no null checks,
- opaque reflection calls,
- swallowed exceptions.

Better:

- small generated units,
- meaningful names,
- normal Java code,
- line-friendly formatting,
- deterministic behavior.

---

## 36. Mental Model Summary

Annotation processing is not about “annotation magic”.

It is about moving some reasoning from runtime to compile-time.

A good processor:

1. reads explicit metadata,
2. validates structural rules,
3. builds an internal model,
4. generates boring deterministic code/resource,
5. reports actionable diagnostics,
6. respects build tools,
7. respects package/module boundaries,
8. keeps runtime simpler.

A bad processor:

1. hides too much behavior,
2. loads application classes,
3. scans the world,
4. generates unreadable code,
5. breaks incremental builds,
6. creates accidental public APIs,
7. makes build failures mysterious.

The top-level engineering insight:

> Annotation processing is a way to make architecture executable at compile-time.

For enterprise/regulatory systems, this is extremely valuable because many rules are structural:

- states must be finite,
- commands must be valid,
- handlers must return standard results,
- generated IDs/codes must be stable,
- internal packages must not leak,
- transitions must be auditable,
- metadata must be deterministic.

These rules are often too important to rely only on convention.

---

## 37. What You Should Be Able to Do After This Part

After mastering this part, you should be able to:

1. explain annotation processing lifecycle,
2. distinguish annotation processor from reflection and bytecode generation,
3. write a minimal `AbstractProcessor`,
4. use `ProcessingEnvironment`, `RoundEnvironment`, `Element`, `TypeElement`, `TypeMirror`, `Filer`, and `Messager`,
5. understand processing rounds,
6. generate source safely,
7. generate resources safely,
8. report useful compile-time errors,
9. avoid loading application classes,
10. integrate processors with Maven/Gradle,
11. reason about incremental build impact,
12. design annotation API separately from processor implementation,
13. enforce architecture rules at compile-time,
14. generate deterministic metadata indexes,
15. evaluate whether annotation processing is the correct tool.

---

## 38. References

- Java SE 25 API: `javax.annotation.processing.AbstractProcessor`
- Java SE 25 API: `javax.annotation.processing.Processor`
- Java SE 25 API: `javax.annotation.processing.RoundEnvironment`
- Java SE 25 API: `javax.annotation.processing.ProcessingEnvironment`
- Java SE 25 API: `javax.annotation.processing.Filer`
- Java SE 25 API: `javax.annotation.processing.Messager`
- Java SE 25 API: `javax.lang.model.element`
- Java SE 25 API: `javax.lang.model.type`
- Java SE 25 API: `javax.lang.model.util.Elements`
- Java SE 25 API: `javax.lang.model.util.Types`
- OpenJDK compiler group documentation on annotation processing
- Maven Compiler Plugin documentation on annotation processors
- Gradle Java Plugin documentation on annotation processor configuration and incremental compilation

---

## 39. Status Seri

Seri **belum selesai**.

Part yang sudah selesai:

- Part 000 — Orientation
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

Berikutnya:

- **Part 023 — Code Generation Strategy: Source Generation, Runtime Generation, Bytecode Generation**
