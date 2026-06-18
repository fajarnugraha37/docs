# learn-java-jakarta-part-030.md

# Bagian 30 — Jakarta Debugging Support for Other Languages: SMAP, SourceDebugExtension, Generated Code, dan Tooling-Oriented Debuggability

> Target pembaca: Java engineer yang ingin memahami spesifikasi Jakarta yang jarang dibahas tetapi penting untuk tooling: **Jakarta Debugging Support for Other Languages**. Ini bukan API aplikasi harian seperti Servlet/JPA/CDI, melainkan mekanisme agar source code yang **ditranslasikan/generate menjadi Java/class file** tetap bisa di-debug dengan referensi ke source aslinya.
>
> Fokus bagian ini: Jakarta Debugging Support for Other Languages 2.0, JSR 45 heritage, Source Map / SMAP, `SourceDebugExtension` class file attribute, translated-source vs final-source, strata, language processor, compiler, post-processor, JPDA/JDI debugger integration, JSP generated servlet debugging, template/code generation, multi-level translation, source file lookup, limitations, observability, build pipeline, and production failure modes.

---

## Daftar Isi

1. [Orientasi: Spesifikasi Ini Jarang Dipakai Langsung, tapi Penting](#1-orientasi-spesifikasi-ini-jarang-dipakai-langsung-tapi-penting)
2. [Mental Model: Source Asli → Generated Source → Class File → Debugger](#2-mental-model-source-asli--generated-source--class-file--debugger)
3. [Jakarta Debugging Support 2.0 dalam Jakarta EE 11](#3-jakarta-debugging-support-20-dalam-jakarta-ee-11)
4. [Kenapa Ini Ada? Problem Generated Code](#4-kenapa-ini-ada-problem-generated-code)
5. [Istilah Penting: Translated-Source, Final-Source, Stratum, SMAP](#5-istilah-penting-translated-source-final-source-stratum-smap)
6. [Source Map / SMAP: Inti Spesifikasi](#6-source-map--smap-inti-spesifikasi)
7. [`SourceDebugExtension`: Attribute di Class File](#7-sourcedebugextension-attribute-di-class-file)
8. [Single Translation Flow](#8-single-translation-flow)
9. [Multiple Translation Flow](#9-multiple-translation-flow)
10. [Strata: Multi-Level Source View](#10-strata-multi-level-source-view)
11. [SMAP File Format: Big Picture](#11-smap-file-format-big-picture)
12. [SMAP Header](#12-smap-header)
13. [Stratum Section](#13-stratum-section)
14. [File Section](#14-file-section)
15. [Line Section](#15-line-section)
16. [Embedded Source Maps](#16-embedded-source-maps)
17. [SMAP Resolution](#17-smap-resolution)
18. [Finding Source Files](#18-finding-source-files)
19. [Multiple Source Files per Class File](#19-multiple-source-files-per-class-file)
20. [JPDA, JDI, dan Debugger Integration](#20-jpda-jdi-dan-debugger-integration)
21. [Apa yang Tidak Dicakup: Variables dan Data Views](#21-apa-yang-tidak-dicakup-variables-dan-data-views)
22. [Contoh Utama: JSP/Jakarta Pages ke Generated Servlet](#22-contoh-utama-jspjakarta-pages-ke-generated-servlet)
23. [Facelets, Templates, Code Generation, dan Annotation Processing](#23-facelets-templates-code-generation-dan-annotation-processing)
24. [Modern Analogy: Source Map di JavaScript/TypeScript](#24-modern-analogy-source-map-di-javascripttypescript)
25. [Generated Code Debugging di Enterprise Java](#25-generated-code-debugging-di-enterprise-java)
26. [Build Pipeline Responsibility](#26-build-pipeline-responsibility)
27. [Runtime Responsibility](#27-runtime-responsibility)
28. [IDE/Debugger Responsibility](#28-idedebugger-responsibility)
29. [Observability: Stack Trace, Logs, Source Mapping](#29-observability-stack-trace-logs-source-mapping)
30. [Security dan Source Exposure](#30-security-dan-source-exposure)
31. [Performance dan Class File Size](#31-performance-dan-class-file-size)
32. [Debuggability as Engineering Quality](#32-debuggability-as-engineering-quality)
33. [Testing Source Mapping](#33-testing-source-mapping)
34. [Production Failure Modes](#34-production-failure-modes)
35. [Best Practices dan Anti-Patterns](#35-best-practices-dan-anti-patterns)
36. [Checklist Review](#36-checklist-review)
37. [Case Study 1: Error di JSP tapi Stack Trace Menunjuk Generated Servlet](#37-case-study-1-error-di-jsp-tapi-stack-trace-menunjuk-generated-servlet)
38. [Case Study 2: Custom DSL Generate Java tapi Tidak Debuggable](#38-case-study-2-custom-dsl-generate-java-tapi-tidak-debuggable)
39. [Case Study 3: Multi-Level Translation dan Line Mapping Rusak](#39-case-study-3-multi-level-translation-dan-line-mapping-rusak)
40. [Case Study 4: Source Path Tidak Cocok di CI/CD Container](#40-case-study-4-source-path-tidak-cocok-di-cicd-container)
41. [Latihan Bertahap](#41-latihan-bertahap)
42. [Mini Project: Source Mapping and Generated Code Debugging Lab](#42-mini-project-source-mapping-and-generated-code-debugging-lab)
43. [Referensi Resmi](#43-referensi-resmi)

---

# 1. Orientasi: Spesifikasi Ini Jarang Dipakai Langsung, tapi Penting

Tidak semua spesifikasi Jakarta EE adalah API yang kamu panggil setiap hari.

Beberapa spesifikasi lebih bersifat:

- platform support;
- tooling support;
- compatibility;
- debugging;
- deployment/runtime contract.

Jakarta Debugging Support for Other Languages adalah contoh yang sangat jelas.

Kamu mungkin tidak pernah menulis:

```java
import jakarta.debugging.*;
```

karena spesifikasi ini bukan API aplikasi harian seperti:

```java
jakarta.persistence
jakarta.servlet
jakarta.ws.rs
jakarta.enterprise.context
```

Spesifikasi ini mendefinisikan mekanisme agar program yang berjalan di JVM tetapi ditulis dalam bahasa atau source format selain Java tetap bisa di-debug dengan referensi ke source aslinya.

## 1.1 Kenapa penting?

Karena di Jakarta/Java ecosystem banyak hal bukan langsung ditulis sebagai Java class final:

- JSP diterjemahkan menjadi Servlet Java;
- template engine dapat menghasilkan Java source;
- DSL dapat digenerate menjadi Java;
- annotation processor/code generator dapat membuat class;
- polyglot language dapat menghasilkan bytecode;
- framework dapat membuat generated artifacts;
- build tools dapat melakukan transformasi source.

Tanpa source mapping, debugger dan stack trace bisa menunjuk ke generated code yang tidak ingin dibaca developer.

## 1.2 Masalah nyata

Developer melihat error:

```text
NullPointerException at org.apache.jsp.WEB_002dINF.views.users.list_jsp._jspService(list_jsp.java:193)
```

Padahal developer ingin tahu:

```text
/WEB-INF/views/users/list.jsp line 42
```

Jakarta Debugging Support memberi model agar mapping semacam ini bisa dilakukan.

## 1.3 Spesifikasi ini berasal dari JSR 45

Jakarta Debugging Support for Other Languages 1.0 adalah re-release dari JSR 45 di bawah Eclipse Foundation Specification License.

Versi 2.0 pindah ke `jakarta.*` namespace dalam era Jakarta EE 9.

## 1.4 Prinsip utama

```text
Generated code must be debuggable from the developer's original source view.
```

Jika generated code tidak bisa dilacak balik ke source asli, maintainability turun drastis.

---

# 2. Mental Model: Source Asli → Generated Source → Class File → Debugger

Mental model dasar:

```text
Original source
  ↓ language processor / translator
Generated source
  ↓ compiler
Class file
  ↓ debugger reads debug metadata
Original source line shown to developer
```

## 2.1 Tanpa source map

```text
JSP line 42
  ↓ translated
Generated Servlet line 193
  ↓ compiled
Debugger shows generated servlet line 193
```

Developer harus membaca generated servlet.

## 2.2 Dengan source map

```text
JSP line 42
  ↓ translated + SMAP generated
Generated Servlet line 193
  ↓ compiled + SourceDebugExtension inserted
Debugger maps line 193 back to JSP line 42
```

Developer melihat source yang ia tulis.

## 2.3 Siapa yang membuat mapping?

Language processor / translator.

Contoh:

```text
JSP compiler
template compiler
DSL compiler
custom code generator
```

## 2.4 Siapa yang menyimpan mapping?

Mapping disimpan dalam bentuk SMAP dan akhirnya dalam class file attribute:

```text
SourceDebugExtension
```

## 2.5 Siapa yang membaca mapping?

Debugger/tooling berbasis JPDA/JDI.

## 2.6 Kenapa class file?

Karena JVM menjalankan class file.

Jika mapping ikut class file, debugger punya informasi dekat dengan artifact yang dieksekusi.

---

# 3. Jakarta Debugging Support 2.0 dalam Jakarta EE 11

Jakarta Debugging Support for Other Languages 2.0 adalah versi yang dirilis pada era Jakarta EE 9, dengan perubahan utama pindah ke `jakarta.*` namespace.

Dalam Jakarta EE 11 release plan, spesifikasi ini tetap tercantum sebagai:

```text
Jakarta Debugging Support for Other Languages 2.0
```

Jadi untuk Jakarta EE 11, versi yang relevan tetap 2.0.

## 3.1 Tujuan resmi

Spesifikasi ini menyediakan mekanisme agar program yang dieksekusi di JVM tetapi ditulis dalam bahasa selain Java bisa di-debug dengan referensi ke source asli, misalnya file source dan line number.

## 3.2 Minimum Java

Halaman rilis spesifikasi menyebut minimum Java SE 8 atau lebih tinggi.

Namun Jakarta EE 11 sebagai platform modern memiliki baseline runtime yang lebih baru sesuai platform release.

## 3.3 Tidak ada API aplikasi populer

Ini bukan spesifikasi yang biasanya kamu inject/call.

Ia lebih relevan untuk:

- tool implementor;
- container implementor;
- JSP compiler implementor;
- language/compiler implementor;
- IDE/debugger tooling;
- build tool authors.

## 3.4 Kenapa tetap ada di platform?

Karena Jakarta EE tetap mendukung teknologi seperti Jakarta Pages/JSP yang menghasilkan servlet dari source non-Java.

Debugging yang benar adalah bagian dari platform usability.

## 3.5 Apa perubahan 2.0?

Perubahan utama: pindah ke `jakarta.*` namespace.

Tidak ada removals/deprecations/backwards incompatible changes yang dicatat di halaman rilis 2.0.

---

# 4. Kenapa Ini Ada? Problem Generated Code

Generated code bagus untuk produktivitas, tetapi buruk untuk debugging jika tidak ada mapping.

## 4.1 Contoh JSP

Developer menulis:

```jsp
<c:forEach var="user" items="${users}">
  <c:out value="${user.name}" />
</c:forEach>
```

Container menghasilkan Java Servlet.

Jika error terjadi di generated Servlet, line number generated Servlet tidak langsung bermakna untuk developer.

## 4.2 Contoh template engine

Template:

```text
Hello {{user.name}}
```

Generated Java:

```java
out.write("Hello ");
out.write(user.getName());
```

Error terjadi pada generated Java line tertentu.

Developer ingin tahu template line.

## 4.3 Contoh DSL

DSL:

```text
rule ApproveCase when amount < 1000 then approve
```

Generated Java:

```java
public boolean evaluate(Context ctx) { ... }
```

Jika bug muncul, developer ingin tahu DSL rule line.

## 4.4 Contoh multi-level

```text
DSL
  ↓ generates Java-like source
  ↓ annotation processor generates final Java
  ↓ compiler generates class
```

Mapping harus melewati lebih dari satu translation layer.

## 4.5 Tanpa mapping

Masalah:

- stack trace sulit dipahami;
- breakpoint sulit dipasang;
- line coverage misleading;
- developer membaca generated code;
- production troubleshooting lambat;
- tools tidak bisa menampilkan source asli.

## 4.6 Dengan mapping

Debugger/tooling bisa:

- menampilkan source asli;
- menaruh breakpoint di source asli;
- mengaitkan line execution ke source asli;
- memperbaiki stack trace/diagnostics;
- meningkatkan developer experience.

---

# 5. Istilah Penting: Translated-Source, Final-Source, Stratum, SMAP

## 5.1 Translated-source

Source input yang ditranslasikan.

Contoh:

```text
users.jsp
template.foo
rules.dsl
```

## 5.2 Final-source

Output source yang akhirnya dikompilasi atau direpresentasikan dalam class file.

Contoh:

```text
users_jsp.java
GeneratedRule.java
```

Catatan: final-source tidak harus selalu Java source eksplisit; compiler/language implementor bisa langsung menghasilkan class file.

## 5.3 Language processor

Komponen yang menerjemahkan translated-source menjadi final-source atau intermediate source.

Contoh:

```text
JSP compiler/translator
DSL compiler
template compiler
```

## 5.4 Compiler

Menghasilkan class file dari final-source.

## 5.5 Post-processor

Komponen yang mengambil class file + SMAP file lalu memasukkan `SourceDebugExtension` attribute.

## 5.6 SMAP

Source Map yang menjelaskan mapping antara source input dan output.

## 5.7 SMAP-file

File berisi SMAP yang dibuat language processor.

## 5.8 Stratum

View source pada level bahasa tertentu.

Contoh strata:

```text
JSP
Java
FooDSL
```

## 5.9 SourceDebugExtension

Class file attribute yang menyimpan SMAP.

## 5.10 JPDA/JDI

Debugger architecture/API Java yang dapat menggunakan informasi ini untuk source-level debugging.

---

# 6. Source Map / SMAP: Inti Spesifikasi

SMAP adalah format mapping source.

Secara konseptual:

```text
Generated line 193 → users.jsp line 42
Generated line 194 → header.jspf line 10
Generated line 200 → users.jsp line 50
```

## 6.1 Kenapa tidak cukup LineNumberTable?

Class file sudah punya:

```text
SourceFile
LineNumberTable
```

Tapi itu biasanya mengasumsikan satu source file per class file dan mapping sederhana.

JSP/template generated code bisa berasal dari banyak source fragments.

SMAP mendukung multiple source files per stratum.

## 6.2 Kenapa tidak sekadar rewrite SourceFile?

Karena:

- satu class file bisa berasal dari banyak source file;
- include/import/template composition;
- multi-level translation;
- beberapa bahasa/source view;
- debugger mungkin perlu memilih stratum.

## 6.3 SMAP berisi

- header;
- stratum sections;
- file sections;
- line sections;
- vendor sections;
- embedded source map markers;
- end section.

## 6.4 SMAP adalah text

Formatnya text berbasis UTF-8.

## 6.5 SMAP resolved vs unresolved

SMAP-file dari language processor bisa berisi unresolved/embedded SMAP.

SMAP dalam `SourceDebugExtension` harus resolved.

## 6.6 Unknown section

Spesifikasi mengizinkan section type baru; unknown section harus diabaikan tanpa error.

Ini penting untuk forward compatibility.

---

# 7. `SourceDebugExtension`: Attribute di Class File

`SourceDebugExtension` adalah attribute class file JVM.

Dalam konteks spesifikasi ini, attribute tersebut menyimpan SMAP.

## 7.1 Kenapa attribute class file?

Karena debugger membaca class file/debug metadata.

Jika mapping disimpan di class file, artifact executable membawa mapping.

## 7.2 Siapa menambahkan attribute?

Dua pilihan:

1. Post-processor menambahkan attribute setelah compilation.
2. Compiler langsung menerima final-source + SMAP-file lalu memasukkan attribute.

## 7.3 Apa isinya?

Resolved SMAP.

## 7.4 Apa manfaatnya?

Debugger dapat mengkonversi line number final-source menjadi line number translated-source.

## 7.5 Class file size

Attribute menambah ukuran class file.

Biasanya kecil dibanding manfaat debugability, tetapi generated code besar bisa berdampak.

## 7.6 Production artifact

Pertanyaan penting:

```text
Should production class files include SourceDebugExtension?
```

Jawabannya tergantung policy:

- debugging/observability benefit;
- source path exposure risk;
- artifact size;
- security requirements.

## 7.7 Strip or keep?

Some organizations keep debug metadata in production for better stack trace/source correlation.

Others strip for security/size.

Document decision.

---

# 8. Single Translation Flow

Single translation adalah skenario paling sederhana.

```text
translated-source
  ↓ language processor
final-source + SMAP-file
  ↓ compiler
class file
  ↓ post-processor
class file with SourceDebugExtension
```

## 8.1 Example

```text
users.jsp
  ↓ JSP translator
users_jsp.java + users_jsp.smap
  ↓ javac
users_jsp.class
  ↓ SMAP post-processor
users_jsp.class with SourceDebugExtension
```

## 8.2 Debug flow

```text
Debugger sees execution at generated line
  ↓ reads SourceDebugExtension
  ↓ maps to JSP stratum
  ↓ shows users.jsp line
```

## 8.3 Why language processor creates SMAP?

Because only translator knows which generated line came from which original source line.

## 8.4 Compiler role

Compiler may not understand original language.

It compiles final-source.

## 8.5 Post-processor role

Adds source mapping metadata into resulting class.

## 8.6 Alternative

Compiler does both compilation and SourceDebugExtension installation.

---

# 9. Multiple Translation Flow

Multiple translation happens when source passes through several transformations.

## 9.1 Example

```text
template.foo
  ↓ template compiler
intermediate.java.template
  ↓ second processor
GeneratedServlet.java
  ↓ javac
class file
```

## 9.2 Each translation produces mapping

Each stage should preserve mapping.

## 9.3 Embedded SMAP

A language processor may find existing SMAP for input source and embed it into generated SMAP.

## 9.4 Resolution

Before storing in `SourceDebugExtension`, embedded maps must be resolved into final mapping.

## 9.5 Why hard?

Line mapping becomes composition of transformations:

```text
Original line A
  → intermediate line B
  → final-source line C
  → class bytecode line D
```

## 9.6 Debugger experience

Ideally debugger can show original source stratum, not intermediate generated files.

## 9.7 Failure mode

If one processor drops SMAP, mapping chain breaks.

## 9.8 Engineering rule

If you build code generation pipeline, treat debug mapping as first-class output.

---

# 10. Strata: Multi-Level Source View

Stratum is a named source view.

Examples:

```text
Java
JSP
FooTemplate
RuleDSL
```

## 10.1 Why multiple strata?

One class file may be viewed as:

- final Java source;
- original JSP;
- original DSL;
- intermediate source.

## 10.2 Default stratum

SMAP header can specify default stratum.

Debugger can use default if not explicitly selecting another.

## 10.3 Java stratum

Final-source Java view is usually named Java and can be created automatically.

## 10.4 Non-Java stratum

Example:

```text
JSP
```

maps generated Java lines back to JSP lines.

## 10.5 Tooling implication

Debugger UI can let developer choose source level.

## 10.6 Developer implication

When debugging generated code, ask:

```text
Which source view am I seeing?
```

## 10.7 Multiple translated sources

Each language/source level can have its own stratum.

---

# 11. SMAP File Format: Big Picture

An SMAP is text with sections.

Conceptual structure:

```text
SMAP
<generated-file-name>
<default-stratum>
*S <stratum-name>
*F
<file mappings>
*L
<line mappings>
*E
```

## 11.1 Sections

Important sections:

- header;
- stratum section;
- file section;
- line section;
- vendor section;
- embedded SMAP open/close;
- end section.

## 11.2 Header

Identifies as SMAP and gives generated file/default stratum.

## 11.3 File section

Maps file IDs to source file names/paths.

## 11.4 Line section

Maps input lines to output lines.

## 11.5 End section

Marks end.

## 11.6 Human-readable

SMAP is text, but line mapping syntax can be compact.

## 11.7 Generated by tooling

Application developers rarely write SMAP manually.

## 11.8 Why understand it?

To debug toolchain issues and understand why source-level debugging works/fails.

---

# 12. SMAP Header

Header starts with:

```text
SMAP
```

Then generated file name.

Then default stratum.

## 12.1 Example

```text
SMAP
users_jsp.java
JSP
```

## 12.2 Generated file name

Usually final-source file name, no path.

It should match relevant `SourceFile` attribute if final-source.

## 12.3 Default stratum

The source view used by default.

Example:

```text
JSP
```

## 12.4 Resolved SMAP requirement

In resolved SMAP, default stratum must be specified.

## 12.5 Java default

If debugger should use standard final-source Java information, default can be Java.

## 12.6 Debugging bug

Wrong default stratum can make debugger show generated source instead of original source.

---

# 13. Stratum Section

Stratum section begins with:

```text
*S <stratum-name>
```

Example:

```text
*S JSP
```

## 13.1 Purpose

Introduces mapping information for a source language/view.

## 13.2 Required sections after stratum

A file section and line section must follow before next stratum/end.

## 13.3 Unique stratum name

Each translated-source language should have unique stratum name.

## 13.4 Java stratum

Final-source stratum named Java is created automatically and usually not represented as explicit stratum section.

## 13.5 Vendor sections

Vendor sections may follow stratum for extension.

## 13.6 Debugger selection

Debugger can use stratum name to select source view.

---

# 14. File Section

File section starts:

```text
*F
```

It maps file IDs to source names/paths.

## 14.1 Simple form

```text
1 users.jsp
```

## 14.2 Source path form

```text
+ 1 users.jsp
/WEB-INF/views/users.jsp
```

## 14.3 Why file ID?

Line section refers to file IDs compactly.

## 14.4 Multiple files

Important for includes:

```text
1 users.jsp
2 header.jspf
3 footer.jspf
```

## 14.5 Primary file

First file line denotes primary file.

## 14.6 Source path

Path helps debugger locate file.

## 14.7 Portability

Paths must make sense in developer environment or source lookup config.

Absolute build container paths can be problematic.

---

# 15. Line Section

Line section starts:

```text
*L
```

It maps input source lines to output source lines.

## 15.1 Conceptual mapping

```text
JSP line 42 → generated Java line 193
```

## 15.2 Compact syntax

SMAP line syntax supports ranges and repeats to reduce size.

## 15.3 Why ranges?

Generated code often maps chunks of lines.

Compact notation keeps class file smaller.

## 15.4 File ID references

Line mappings can reference source file ID from FileSection.

## 15.5 Debugger usage

Debugger converts final-source line to translated-source line using this mapping.

## 15.6 Off-by-one bugs

Generated code tools can create off-by-one line mapping errors.

These are painful.

## 15.7 Test line mapping

Breakpoints and stack traces should point to expected original line.

---

# 16. Embedded Source Maps

Embedded SMAPs support multi-level translation.

## 16.1 Why embed?

If input source already has SMAP, a processor must preserve it.

## 16.2 Example

```text
template
  ↓ processor A with SMAP
intermediate source
  ↓ processor B embeds prior SMAP
final source
```

## 16.3 Open/close embedded sections

SMAP format includes open and close embedded section markers.

## 16.4 Resolution

Embedded maps are not what final debugger should consume directly.

They must be resolved.

## 16.5 Toolchain responsibility

Every translator must be source-map-aware if debug fidelity matters.

## 16.6 Failure

A processor that ignores embedded SMAP causes debugger to jump only to intermediate source.

---

# 17. SMAP Resolution

Resolution composes embedded mappings into a final mapping.

## 17.1 Goal

Final `SourceDebugExtension` contains resolved SMAP.

## 17.2 No embedded maps in final attribute

The SMAP stored in `SourceDebugExtension` should have no embedded SMAPs.

## 17.3 Output language

Resolved SMAP uses final-source language as output language.

## 17.4 Why needed?

Debugger should not recursively resolve chains at runtime.

Tooling resolves during build/translation.

## 17.5 Common issue

Generated classes include unresolved SMAP or broken mapping.

Debugger fails or shows wrong lines.

## 17.6 Validation

Build/test pipeline can inspect class file attribute and verify mapping.

---

# 18. Finding Source Files

Mapping line numbers is not enough.

Debugger must find source files.

## 18.1 Traditional source lookup

Existing debuggers often combine:

- source path;
- package name converted to directory path;
- source file name from JDI call.

## 18.2 Translated-source directory

Source path must include translated-source directories.

Example:

```text
src/main/webapp/WEB-INF/views
```

for JSP.

## 18.3 Package directory mismatch

Generated class package may not match JSP path.

SMAP source path helps.

## 18.4 Flexible source lookup

Spec introduced support so debuggers can get source path information more flexibly through newer API methods.

## 18.5 CI/CD container problem

If SMAP source path is:

```text
/workspace/build/app/src/main/webapp/WEB-INF/views/users.jsp
```

but developer machine uses:

```text
C:\repo\app\src\main\webapp\WEB-INF\views\users.jsp
```

debugger needs source path mapping.

## 18.6 Best practice

Use relative source paths where possible.

Document source lookup settings.

---

# 19. Multiple Source Files per Class File

A generated class can come from multiple source files.

## 19.1 JSP include example

```text
main.jsp
  includes header.jspf
  includes table.jspf
  includes footer.jspf
```

Generated servlet:

```text
main_jsp.class
```

contains code from all fragments.

## 19.2 SourceFile limitation

Class file `SourceFile` attribute can associate only one source file.

## 19.3 SMAP advantage

SMAP can map virtually unlimited number of source files per stratum.

## 19.4 Debugger behavior

Breakpoint in included file can map to generated class line.

## 19.5 Failure mode

If include file mapping absent, stack trace points to main generated source.

## 19.6 Design implication

Template/include systems should emit mappings for all fragments.

---

# 20. JPDA, JDI, dan Debugger Integration

## 20.1 JPDA

Java Platform Debugger Architecture.

## 20.2 JDI

Java Debug Interface.

Debugger tools can use JDI to inspect running JVM and debug metadata.

## 20.3 How mapping is used

When program is debugged with JDI-based debugger, final-source line information can be converted to source view/strata.

## 20.4 Breakpoints

Debugger can set breakpoint in original source if mapping available.

## 20.5 Stack traces

Stack trace printed by JVM may still show generated class/method names unless tooling remaps.

SourceDebugExtension mainly helps debugger/source view.

## 20.6 IDE support

IDE/container integration determines actual user experience.

## 20.7 Remote debugging

Source lookup paths matter even more in remote debugging.

## 20.8 Tool mismatch

Even if class file contains SMAP, a debugger that ignores it may not show original source.

---

# 21. Apa yang Tidak Dicakup: Variables dan Data Views

Spec scope explicitly does not include mapping variable semantics/data views across languages in this version.

## 21.1 What this means

Line/source mapping is supported.

But mapping local variables from generated Java back to original language variables is much harder.

## 21.2 Example

Original:

```jsp
${user.name}
```

Generated Java may use temporary variables.

Debugger may show generated variables, not conceptual JSP variables.

## 21.3 Data view problem

Different languages have different variable scopes and runtime semantics.

## 21.4 Practical implication

Do not expect perfect debugging experience.

Line breakpoints/source display may work, but variable inspection may still be generated-code-oriented.

## 21.5 Tooling may improve

IDE/framework tools can add higher-level support, but not mandated by this spec.

---

# 22. Contoh Utama: JSP/Jakarta Pages ke Generated Servlet

Jakarta Pages/JSP adalah contoh klasik.

## 22.1 Developer source

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>

<c:forEach var="user" items="${users}">
  <c:out value="${user.name}" />
</c:forEach>
```

## 22.2 Generated source

Container generates servlet Java class.

Conceptually:

```java
public final class users_jsp extends HttpServlet {
    public void _jspService(...) {
        // tag handler invocations
        // EL evaluation
        // out.write(...)
    }
}
```

## 22.3 Debug problem

Exception line:

```text
users_jsp.java:193
```

Developer wants:

```text
users.jsp:42
```

## 22.4 SMAP solution

JSP translator emits SMAP mapping generated lines to JSP lines and included files.

## 22.5 Included fragments

If JSP includes header/footer, SMAP can map generated lines to included files too.

## 22.6 Production debugging

Even if IDE not attached, good source mapping helps dev/debug builds, generated source inspection, and observability tooling.

## 22.7 Developer habit

When debugging JSP, know where generated servlet is stored by container.

Also know whether SMAP/source map support is enabled.

---

# 23. Facelets, Templates, Code Generation, dan Annotation Processing

## 23.1 Facelets

Jakarta Faces Facelets is not JSP, but also involves view declaration processing.

Its debugging model may use different tooling/runtime support.

## 23.2 Template engines

Some template engines generate Java classes for fast rendering.

If they generate class files, source mapping can help.

## 23.3 Annotation processors

Annotation processors generate Java source.

Typical Java source debugging uses generated source files and normal line numbers, but mapping back to annotations/original source may need custom tooling.

## 23.4 DSL compilers

Enterprise systems sometimes define DSLs:

- rules;
- workflows;
- forms;
- reports;
- queries.

If compiled to Java/class files, SMAP-like mapping matters.

## 23.5 Bytecode generation frameworks

Libraries generating bytecode at runtime usually do not map to original domain source.

Debuggability can suffer.

## 23.6 Top-tier insight

Any time you generate code, ask:

```text
How will a developer debug this at 3 AM?
```

---

# 24. Modern Analogy: Source Map di JavaScript/TypeScript

Modern frontend developers know source maps:

```text
TypeScript/Sass/etc → JavaScript/CSS → browser debugger maps back to original source
```

Jakarta Debugging Support is analogous in JVM world:

```text
JSP/DSL/template → Java/class file → debugger maps back to original source
```

## 24.1 Similarities

- mapping generated code to original source;
- line/file mapping;
- debugger integration;
- build pipeline responsibility;
- source path issues.

## 24.2 Differences

- SMAP is stored in JVM class file attribute;
- source strata concept;
- JPDA/JDI integration;
- target is JVM debug tooling.

## 24.3 Why analogy helps

It makes an obscure Jakarta spec easier to understand.

## 24.4 Same engineering lesson

Generated code without source maps is hostile to debugging.

---

# 25. Generated Code Debugging di Enterprise Java

Enterprise Java often has generated code:

- JAXB classes;
- JPA metamodel;
- QueryDSL classes;
- MapStruct mappers;
- gRPC/protobuf stubs;
- OpenAPI generated clients;
- JAX-WS generated artifacts;
- JSP generated servlets;
- CDI proxies;
- bytecode-generated classes.

## 25.1 Not all use SMAP

Many generated Java sources are simply compiled as Java with normal line numbers.

SMAP is especially relevant when generated code needs to map back to non-Java source.

## 25.2 Generated source should be inspectable

Store generated sources in build output when useful.

## 25.3 Stack trace readability

Generated class names should be recognizable.

## 25.4 Mapping strategy

For every generation stage:

- original input file;
- generated output file;
- source mapping;
- generated source retention;
- reproducible generation.

## 25.5 Debugging generated proxies

Framework-generated proxies may not map to user source.

Use framework logs/tooling.

## 25.6 Production support

If production stack traces include generated classes, runbooks should explain how to map them.

---

# 26. Build Pipeline Responsibility

Build pipeline must preserve debugging metadata if needed.

## 26.1 Generate SMAP

Translator/code generator emits SMAP-file.

## 26.2 Compile

Compiler compiles generated source.

## 26.3 Insert SourceDebugExtension

Post-processor/ compiler inserts resolved SMAP into class file.

## 26.4 Package

Packaged artifact includes class file with debug attribute.

## 26.5 Source retention

Original source files are accessible to debugger/source server.

## 26.6 Reproducibility

Generated source and mapping should be reproducible from same input.

## 26.7 CI validation

CI can test:

- generated source exists;
- SMAP exists;
- class contains SourceDebugExtension;
- mapping points to expected original line.

## 26.8 Do not strip accidentally

Obfuscation/minification/classfile stripping can remove debug attributes.

Document.

---

# 27. Runtime Responsibility

Runtime/container may perform JSP translation at runtime.

## 27.1 Runtime generation

Some containers compile JSP on first request.

## 27.2 Work directory

Generated servlet source/class often stored in server work/temp directory.

## 27.3 Debug config

Server may have settings controlling:

- keep generated source;
- generate SMAP;
- compile with debug info;
- JSP recompile check;
- development mode.

## 27.4 Production config

Production may precompile JSP and disable runtime recompilation.

## 27.5 Source mapping availability

If server config disables debug generation, IDE debugging experience may degrade.

## 27.6 Runbook

For JSP-heavy app, document:

- where generated source lives;
- how to enable debug info;
- how to precompile JSP;
- how to inspect SMAP;
- how to map stack traces.

---

# 28. IDE/Debugger Responsibility

Debugger must understand/use SourceDebugExtension/SMAP.

## 28.1 Source lookup

IDE needs original source path.

## 28.2 Remote debug

Remote server paths may differ from local project paths.

Use source path mapping.

## 28.3 Breakpoints

Breakpoint in JSP/template requires IDE support.

## 28.4 Generated source fallback

If mapping fails, IDE may show generated Java.

## 28.5 Multi-stratum

Debugger may support selecting source stratum.

## 28.6 Version mismatch

If deployed artifact generated from different source version than local workspace, line mapping is wrong.

## 28.7 Reproducible deployment

Always debug against matching source revision.

## 28.8 Tool support varies

Spec enables support, but actual experience depends on IDE/container/debugger.

---

# 29. Observability: Stack Trace, Logs, Source Mapping

## 29.1 Stack trace limitation

Standard JVM stack traces show class/method/file/line from class metadata.

SourceDebugExtension may not automatically rewrite logs.

## 29.2 Tooling can remap

IDE/debugger or custom observability tooling can remap generated lines to original source.

## 29.3 Logs should include view/template info

For template-heavy systems, log:

- template ID;
- view path;
- generated class name;
- correlation ID.

## 29.4 Error wrapping

When template rendering fails, wrap exception with original source location if framework can.

## 29.5 Production diagnostics

Good error:

```text
Render failed: /WEB-INF/views/users/list.jsp:42
```

Bad error:

```text
NullPointerException in list_jsp.java:193
```

## 29.6 Source availability

In production, you may not expose source files, but support systems can map source based on build artifact metadata.

## 29.7 Build metadata

Include:

- git commit;
- build ID;
- generated source version;
- source map version.

---

# 30. Security dan Source Exposure

Debug metadata can reveal information.

## 30.1 Potential exposure

SMAP/source paths may expose:

- internal directory structure;
- source file names;
- template paths;
- technology choices;
- developer/build paths.

## 30.2 Does it expose source content?

`SourceDebugExtension` stores mapping, not necessarily full source content.

But paths/names can still be sensitive.

## 30.3 Production policy

Decide:

- keep debug attributes for support;
- strip debug metadata;
- keep only in staging;
- keep mapping in secure artifact repository.

## 30.4 Error pages

Do not show internal generated class/source paths to end users.

## 30.5 Logs

Internal logs can include source locations, but protect logs.

## 30.6 Obfuscation

Obfuscation can break source mapping.

If obfuscating, preserve mapping internally.

## 30.7 Security vs operability

Stripping all debug info improves obscurity but hurts troubleshooting.

Balance intentionally.

---

# 31. Performance dan Class File Size

## 31.1 Runtime performance

Debug metadata generally does not affect normal execution semantics significantly.

## 31.2 Class loading

Larger class files can marginally affect class loading/storage.

## 31.3 JSP generated class size

Large JSPs can generate large servlets.

SMAP adds metadata.

## 31.4 Build time

Generating/resolving source maps adds build/translation complexity.

## 31.5 Debug builds vs production builds

Some teams enable full mapping in dev/staging and reduce in production.

## 31.6 Avoid huge templates

If SMAP/class file huge, underlying template may also be too large.

Split views/templates.

## 31.7 Measure

Do not guess. Compare artifact size and classloading metrics.

---

# 32. Debuggability as Engineering Quality

Debuggability is not optional polish.

It affects:

- incident response;
- developer onboarding;
- migration;
- runtime support;
- test failure analysis;
- productivity.

## 32.1 Generated code without mapping is technical debt

If a team builds generators/DSLs but ignores debugging, future maintainers pay cost.

## 32.2 Debuggability checklist for generators

A generator should produce:

- readable generated source;
- source map;
- deterministic output;
- comments linking original source;
- clear class names;
- useful error messages;
- build metadata.

## 32.3 Fail fast

If generator cannot map a source construct, report clear diagnostic.

## 32.4 Tooling UX

Developer should set breakpoint in original source, not generated artifact.

## 32.5 Documentation

Document how to debug generated artifacts.

---

# 33. Testing Source Mapping

## 33.1 Unit test mapping generator

Given input source, assert generated line maps to expected source line.

## 33.2 Integration test debugger-like lookup

Compile class, inspect `SourceDebugExtension`, verify SMAP exists.

## 33.3 Stack trace simulation

Trigger exception in generated code and verify tool/runbook maps to source.

## 33.4 Include files

Test mapping for included fragments.

## 33.5 Multi-level translation

Test embedded SMAP resolution.

## 33.6 Source path portability

Run CI on Linux and developer on Windows/macOS.

Check mapping paths.

## 33.7 Version mismatch test

Ensure artifact build ID matches source revision.

## 33.8 Regression tests

Source mappings can break after generator changes.

Protect with tests.

---

# 34. Production Failure Modes

## 34.1 Debugger shows generated Java, not original source

Causes:

- missing SMAP;
- missing SourceDebugExtension;
- debugger not using stratum;
- source path not configured.

## 34.2 Breakpoint not hit

Causes:

- source version mismatch;
- wrong stratum;
- stale generated class;
- optimized/recompiled artifact;
- invalid mapping line.

## 34.3 Stack trace points to generated file only

Cause:

- logging/tooling not remapping.

Fix:

- runbook or framework error wrapper.

## 34.4 Included JSP line wrong

Cause:

- FileSection/LineSection mapping broken for includes.

## 34.5 Multi-level mapping lost

Cause:

- intermediate processor dropped embedded SMAP.

## 34.6 Production artifact stripped debug attributes

Cause:

- build/minify/obfuscation stripping.

## 34.7 Source path invalid in container

Cause:

- absolute build path embedded.

## 34.8 Security leak

Cause:

- error page exposes generated paths/source names.

## 34.9 Inconsistent generated sources

Cause:

- non-reproducible generator.

## 34.10 Huge generated class

Cause:

- giant template/DSL file.

---

# 35. Best Practices dan Anti-Patterns

## 35.1 Best practices

- Preserve source mapping for generated code.
- Keep generated source readable where possible.
- Use deterministic generation.
- Include build/source revision metadata.
- Test mapping for includes and multi-level translation.
- Use relative/portable source paths.
- Document debugger setup.
- Precompile JSP in production builds when appropriate.
- Keep secure source maps/artifacts for support.
- Make generated class names traceable to source.

## 35.2 Anti-pattern: Generated code as black box

If generator output fails, developer should not reverse-engineer bytecode/generated Java blindly.

## 35.3 Anti-pattern: Dropping mapping during transformation

Every translation layer must preserve mapping.

## 35.4 Anti-pattern: Absolute ephemeral build paths

Paths like:

```text
/tmp/build-123/random/users.jsp
```

break remote debugging.

## 35.5 Anti-pattern: No source revision metadata

You cannot map line if you do not know source version.

## 35.6 Anti-pattern: Huge monolithic JSP/template

Large generated class and poor mapping.

## 35.7 Anti-pattern: Exposing internal mapping to users

Never show internal source paths on public error pages.

---

# 36. Checklist Review

## 36.1 For application developers

- [ ] Do I know whether my JSP/templates are precompiled?
- [ ] Do I know where generated source is stored?
- [ ] Can I debug original JSP/template line?
- [ ] Are production errors mapped to source view in runbook?
- [ ] Are source versions matched to deployed artifact?
- [ ] Are internal paths hidden from users?

## 36.2 For generator/tool authors

- [ ] Does generator emit source maps?
- [ ] Are line mappings correct?
- [ ] Are includes/fragments represented?
- [ ] Is multi-level mapping preserved?
- [ ] Is `SourceDebugExtension` inserted?
- [ ] Are mappings tested?
- [ ] Are source paths portable?
- [ ] Is generated code deterministic?

## 36.3 For build/release engineers

- [ ] Are debug attributes preserved or intentionally stripped?
- [ ] Is decision documented?
- [ ] Are generated sources archived?
- [ ] Is build ID/git commit embedded?
- [ ] Is source lookup reproducible?
- [ ] Does CI validate generated artifacts?

## 36.4 For ops/support

- [ ] Can stack traces be mapped to source?
- [ ] Are generated class names understood?
- [ ] Are source maps accessible securely?
- [ ] Are error pages safe?
- [ ] Are logs protected?

---

# 37. Case Study 1: Error di JSP tapi Stack Trace Menunjuk Generated Servlet

## 37.1 Symptom

Production log:

```text
NullPointerException
at org.apache.jsp.WEB_002dINF.views.users.list_jsp._jspService(list_jsp.java:193)
```

## 37.2 Developer problem

`list_jsp.java` is generated.

Developer wants `list.jsp` line.

## 37.3 Investigation

Check:

- generated servlet source;
- SMAP/SourceDebugExtension;
- server JSP debug config;
- source path mapping;
- deployed source revision.

## 37.4 Fix

Enable/validate JSP source mapping in dev/staging.

Update runbook:

```text
list_jsp.java:193 maps to /WEB-INF/views/users/list.jsp:42
```

## 37.5 Long-term

Precompile JSP with mapping and archive generated sources.

## 37.6 Lesson

Generated code errors need source mapping and operational runbook.

---

# 38. Case Study 2: Custom DSL Generate Java tapi Tidak Debuggable

## 38.1 Context

Team builds rule DSL:

```text
rule highRisk:
  when applicant.score > 80
  then requireReview
```

Generator outputs Java.

## 38.2 Problem

Runtime exception points to:

```text
GeneratedRules.java:4021
```

No one knows original DSL line.

## 38.3 Root cause

Generator did not produce source map.

## 38.4 Fix

Generator emits:

- generated Java with comments;
- SMAP mapping DSL line to Java line;
- class file with SourceDebugExtension;
- build report mapping rule IDs to classes/lines.

## 38.5 Additional improvement

Rule engine wraps exceptions with rule name/source location.

## 38.6 Lesson

If you create DSL, debugging is part of the language design.

---

# 39. Case Study 3: Multi-Level Translation dan Line Mapping Rusak

## 39.1 Pipeline

```text
workflow.yaml
  ↓ generator A
workflow.template
  ↓ generator B
WorkflowGenerated.java
  ↓ javac
WorkflowGenerated.class
```

## 39.2 Problem

Debugger maps to `workflow.template`, not `workflow.yaml`.

## 39.3 Root cause

Generator B ignored embedded SMAP from generator A.

## 39.4 Fix

Generator B embeds and resolves previous SMAP.

Final `SourceDebugExtension` maps to original YAML stratum.

## 39.5 Test

Add integration test:

```text
Generated Java line X → workflow.yaml line Y
```

## 39.6 Lesson

Every translation stage must preserve mapping.

---

# 40. Case Study 4: Source Path Tidak Cocok di CI/CD Container

## 40.1 Problem

Debugger cannot find JSP source.

SMAP path:

```text
/builds/gitlab-runner/abc/project/src/main/webapp/WEB-INF/views/list.jsp
```

Developer path:

```text
C:\workspace\project\src\main\webapp\WEB-INF\views\list.jsp
```

## 40.2 Root cause

Absolute CI path embedded in mapping.

## 40.3 Fix

Use relative paths if supported.

Configure IDE source path mapping.

Archive source artifact by build ID.

## 40.4 Lesson

Source mapping is only useful if source lookup works across environments.

---

# 41. Latihan Bertahap

## Latihan 1 — Inspect generated JSP servlet

Run JSP in container.

Find generated servlet source in work directory.

## Latihan 2 — Trigger JSP error

Create intentional exception.

Observe stack trace.

## Latihan 3 — Compare source line

Find generated line and original JSP line.

## Latihan 4 — Check debug metadata

Use `javap -v` or class file viewer to inspect debug attributes.

## Latihan 5 — Include mapping

Create JSP with include file.

Trigger error inside include.

Verify line mapping.

## Latihan 6 — Source path mismatch

Simulate remote debug where source path differs.

Configure IDE mapping.

## Latihan 7 — Generated code comments

Build simple generator that writes comments linking original line.

## Latihan 8 — Simple source map

Create toy mapping file from DSL lines to generated Java lines.

## Latihan 9 — Multi-stage mapping

Compose two mapping layers manually.

## Latihan 10 — Runbook

Write incident runbook for generated code stack traces.

---

# 42. Mini Project: Source Mapping and Generated Code Debugging Lab

## 42.1 Goal

Create:

```text
jakarta-debugging-source-map-lab/
```

## 42.2 Modules

```text
jsp-generated-servlet/
jsp-include-mapping/
classfile-debug-attributes/
toy-dsl-generator/
toy-smap-generator/
multi-level-translation/
source-path-mapping/
production-runbook/
```

## 42.3 Deliverables

```text
README.md
DEBUGGING-MENTAL-MODEL.md
GENERATED-CODE.md
SMAP-BASICS.md
SOURCEDEBUGEXTENSION.md
JSP-DEBUGGING.md
MULTI-LEVEL-MAPPING.md
SOURCE-PATHS.md
SECURITY.md
FAILURE-MODES.md
```

## 42.4 Required experiments

1. Generate JSP servlet.
2. Inspect generated Java.
3. Trigger JSP exception.
4. Map generated line to JSP line.
5. Inspect class file attributes.
6. Build toy DSL → Java generator.
7. Create mapping report.
8. Simulate source path mismatch.
9. Write runbook.
10. Decide whether debug metadata is kept in production.

## 42.5 Evaluation questions

1. What problem does Jakarta Debugging Support solve?
2. What is SMAP?
3. What is `SourceDebugExtension`?
4. What is translated-source?
5. What is final-source?
6. What is a stratum?
7. Why is `SourceFile` not enough?
8. Why are variables not covered?
9. What breaks multi-level source mapping?
10. How do you debug generated JSP stack trace?

---

# 43. Referensi Resmi

Referensi utama:

1. Jakarta Debugging Support for Other Languages 2.0  
   https://jakarta.ee/specifications/debugging/2.0/

2. Jakarta Debugging Support for Other Languages 2.0 Specification  
   https://jakarta.ee/specifications/debugging/2.0/jdsol-spec-2.0

3. Jakarta Debugging Support for Other Languages Specification Overview  
   https://jakarta.ee/specifications/debugging/

4. Jakarta EE 11 Release Plan  
   https://jakartaee.github.io/platform/jakartaee11/JakartaEE11ReleasePlan

5. Jakarta Pages 4.0  
   https://jakarta.ee/specifications/pages/4.0/

6. Jakarta Standard Tag Library 3.0  
   https://jakarta.ee/specifications/tags/3.0/

7. Jakarta Servlet 6.1  
   https://jakarta.ee/specifications/servlet/6.1/

8. Java Platform Debugger Architecture / JPDA  
   https://docs.oracle.com/javase/8/docs/technotes/guides/jpda/

9. Java Virtual Machine Specification — ClassFile attributes  
   https://docs.oracle.com/javase/specs/

10. Jakarta EE 11 Release  
    https://jakarta.ee/release/11/

---

# Penutup

Jakarta Debugging Support for Other Languages adalah spesifikasi tooling/debugging, bukan API bisnis harian.

Mental model ringkas:

```text
Original source
  ↓ translated by language processor
Generated/final source
  ↓ compiled
Class file
  ↓ SourceDebugExtension contains SMAP
Debugger
  ↓ maps generated line to original source line
Developer sees original source
```

Konsep inti:

```text
SMAP:
  Source Map that maps translated-source to final-source

SourceDebugExtension:
  class file attribute that stores resolved SMAP

Stratum:
  named source view/language level

Language processor:
  translator/generator that emits source map

Post-processor:
  inserts mapping into class file if compiler does not
```

Prinsip paling penting:

```text
Generated code is production code.
If it can fail, it must be debuggable.
```

Engineer top-tier tidak hanya tahu cara memakai framework. Ia juga tahu bagaimana framework menghasilkan kode, bagaimana stack trace dan debugger menemukan source asli, kenapa JSP error bisa menunjuk generated servlet, kenapa source path di CI bisa merusak debugging, dan kenapa setiap DSL/code generator harus memikirkan source mapping sejak awal.

Bagian berikutnya akan membahas **Jakarta XML Binding (`jakarta.xml.bind`) / JAXB**: object-XML mapping, schema binding, marshalling/unmarshalling, adapters, validation, namespaces, security, performance, and migration from `javax.xml.bind` to `jakarta.xml.bind`.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-jakarta-part-029.md](./learn-java-jakarta-part-029.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-java-jakarta-part-031.md](./learn-java-jakarta-part-031.md)
