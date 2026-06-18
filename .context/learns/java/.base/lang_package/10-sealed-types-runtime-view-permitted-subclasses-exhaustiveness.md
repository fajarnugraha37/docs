# Part 10 — Sealed Types Runtime View: `Class`, Permitted Subclasses, and Exhaustiveness

Series: `learn-java-lang-dom-sax-core-runtime-platform-contracts`  
File: `10-sealed-types-runtime-view-permitted-subclasses-exhaustiveness.md`  
Target Java: 8–25, dengan fitur sealed types tersedia final sejak Java 17  
Package focus: `java.lang.Class`, sealed classes/interfaces language/runtime contract

---

## 1. Tujuan Part Ini

Part ini membahas sealed types dari sudut **runtime platform contract**, bukan sekadar syntax `sealed`, `permits`, `final`, dan `non-sealed`.

Setelah part ini, kamu diharapkan mampu memahami:

1. apa sebenarnya yang dikunci oleh sealed class/interface;
2. bagaimana sealed hierarchy muncul di runtime melalui `java.lang.Class`;
3. bagaimana `Class::isSealed` dan `Class::getPermittedSubclasses` dapat dipakai dengan benar;
4. kenapa sealed types berguna untuk modelling domain, state machine, command/result/event, dan error taxonomy;
5. kenapa sealed types bukan pengganti access modifier, validation, authorization, atau module encapsulation;
6. bagaimana sealed types berinteraksi dengan records, enums, pattern matching, switch exhaustiveness, reflection, JPMS, serialization, frameworks, dan binary compatibility;
7. failure modes yang muncul ketika hierarchy terlalu dikunci, salah diekspos sebagai public API, atau dipakai pada domain yang sebenarnya dinamis.

Part ini berada setelah pembahasan `Enum` dan `Record` karena sealed types paling kuat saat digabung dengan keduanya:

```java
public sealed interface DecisionResult
        permits DecisionResult.Approved,
                DecisionResult.Rejected,
                DecisionResult.RequiresReview {

    record Approved(String approvalId) implements DecisionResult {}
    record Rejected(String reasonCode) implements DecisionResult {}
    record RequiresReview(String queue, String reason) implements DecisionResult {}
}
```

Model di atas bukan hanya “rapi”. Ia memberi compiler dan runtime informasi bahwa bentuk `DecisionResult` memang terbatas.

---

## 2. Mental Model Utama

### 2.1 Sealed types adalah kontrak “closed direct subtype set”

Sealed type menjawab pertanyaan:

> “Siapa saja direct subclass atau direct implementor yang sah dari tipe ini?”

Contoh:

```java
public sealed interface PaymentOutcome
        permits PaymentOutcome.Success,
                PaymentOutcome.Declined,
                PaymentOutcome.Pending {

    record Success(String transactionId) implements PaymentOutcome {}
    record Declined(String code, String message) implements PaymentOutcome {}
    record Pending(String referenceId) implements PaymentOutcome {}
}
```

`PaymentOutcome` mengatakan:

- direct implementor yang diizinkan hanya `Success`, `Declined`, `Pending`;
- tidak ada class lain yang boleh langsung `implements PaymentOutcome`;
- setiap permitted subtype harus memilih kelanjutannya sendiri:
  - `final` — berhenti di sini;
  - `sealed` — tetap dibatasi lagi;
  - `non-sealed` — membuka kembali inheritance.

Mental modelnya:

```text
unsealed type
    siapa pun bisa extend/implement jika access memungkinkan

final type
    tidak ada subtype lagi

sealed type
    hanya subtype tertentu yang boleh langsung extend/implement

non-sealed type
    subtype permitted yang membuka lagi hierarchy untuk umum
```

Sealed bukan berarti “immutable”. Sealed bukan berarti “safe by default”. Sealed hanya membatasi **direct inheritance path**.

---

### 2.2 Sealed hierarchy adalah modelling tool, bukan security boundary utama

Sealed types sering dipasarkan sebagai “control over inheritance”. Benar, tetapi jangan salah tafsir.

Sealed membantu:

- membuat domain states eksplisit;
- membuat result variants eksplisit;
- menghindari subclass liar;
- membantu exhaustive handling;
- mengurangi invalid polymorphism;
- memperjelas ownership hierarchy.

Sealed tidak otomatis menyelesaikan:

- authorization;
- input validation;
- data integrity;
- object mutation;
- deserialization trust;
- reflection abuse;
- module/package exposure yang buruk;
- binary compatibility governance.

Dengan kata lain:

```text
sealed = inheritance control
not sealed = security model lengkap
```

---

### 2.3 Runtime melihat sealed melalui `Class`

Di runtime, sealed-ness dapat diamati melalui `java.lang.Class`:

```java
Class<?> type = PaymentOutcome.class;

boolean sealed = type.isSealed();
Class<?>[] permitted = type.getPermittedSubclasses();
```

Kontrak penting:

- `isSealed()` mengembalikan `true` jika class/interface tersebut sealed;
- primitive, `void`, dan array bukan sealed;
- `getPermittedSubclasses()` mengembalikan array `Class<?>` untuk permitted direct subclasses jika tipe tersebut sealed;
- hasilnya merepresentasikan **direct permitted subclasses**, bukan semua descendant transitif.

Runtime view ini penting untuk:

- framework validation;
- schema generation;
- command/result dispatch;
- plugin governance;
- exhaustive visitor generation;
- diagnostic tooling;
- compatibility test.

Namun runtime reflection bukan pengganti compiler exhaustiveness. Reflection memberi metadata. Compiler memberi static reasoning.

---

## 3. Konsep Fundamental

### 3.1 Open hierarchy vs closed hierarchy

Sebelum sealed types, Java punya dua ekstrem:

```java
public interface Event {}
```

Siapa pun bisa implement `Event` selama access memungkinkan.

Atau:

```java
public final class Event {}
```

Tidak ada inheritance sama sekali.

Masalahnya, banyak domain berada di tengah:

- variasinya terbatas;
- variasi perlu punya data berbeda;
- caller perlu menangani semua kemungkinan;
- tetapi setiap variasi bukan sekadar enum karena punya payload/behavior.

Contoh:

```java
public sealed interface ImportResult permits ImportResult.Completed,
                                             ImportResult.CompletedWithWarnings,
                                             ImportResult.Failed {

    record Completed(int totalRows) implements ImportResult {}
    record CompletedWithWarnings(int totalRows, int warningCount) implements ImportResult {}
    record Failed(String errorCode, String message) implements ImportResult {}
}
```

Tanpa sealed, kamu punya beberapa opsi lemah:

1. interface terbuka — siapa pun bisa menambah subtype;
2. enum + nullable fields — payload modelling buruk;
3. class hierarchy package-private — kurang fleksibel untuk public API;
4. visitor manual — verbose dan tetap bisa bocor jika hierarchy terbuka.

Sealed memberi titik tengah:

```text
closed enough for reasoning,
polymorphic enough for modelling.
```

---

### 3.2 Direct subtype, bukan semua subtype

Sealed membatasi direct subtype saja.

```java
public sealed class CaseAction permits ManualAction, SystemAction {}

public final class ManualAction extends CaseAction {}

public non-sealed class SystemAction extends CaseAction {}

public class NightlyBatchAction extends SystemAction {}
```

`NightlyBatchAction` boleh ada karena `SystemAction` memilih `non-sealed`.

Jadi permitted set untuk `CaseAction` adalah:

```text
ManualAction
SystemAction
```

Bukan:

```text
ManualAction
SystemAction
NightlyBatchAction
```

Ini penting untuk runtime reflection:

```java
CaseAction.class.getPermittedSubclasses();
```

Hasilnya hanya direct permitted subclasses.

---

### 3.3 Setiap permitted subtype harus eksplisit melanjutkan policy

Permitted subtype tidak boleh diam-diam tidak jelas. Ia harus memilih salah satu:

```java
public sealed class Parent permits ChildA, ChildB, ChildC {}

public final class ChildA extends Parent {}

public sealed class ChildB extends Parent permits GrandChildB1 {}

public non-sealed class ChildC extends Parent {}
```

Maknanya:

| Modifier subtype | Makna |
|---|---|
| `final` | Cabang berhenti. Tidak ada subtype lagi. |
| `sealed` | Cabang tetap tertutup, tetapi punya permitted subtype sendiri. |
| `non-sealed` | Cabang dibuka kembali. Siapa pun bisa extend jika access memungkinkan. |

Ini membuat hierarchy policy eksplisit di setiap node.

---

### 3.4 Records cocok sebagai leaf sealed hierarchy

Record class secara natural cocok sebagai leaf variant:

```java
public sealed interface ValidationOutcome
        permits ValidationOutcome.Valid,
                ValidationOutcome.Invalid {

    record Valid() implements ValidationOutcome {}

    record Invalid(List<String> errors) implements ValidationOutcome {
        public Invalid {
            errors = List.copyOf(errors);
        }
    }
}
```

Kenapa cocok?

- record membawa data varian secara jelas;
- record sudah punya equality/toString yang baik untuk diagnostics;
- record biasanya final secara semantic;
- record mudah dipakai dalam pattern matching;
- sealed interface memberi batas varian.

Namun record tidak otomatis deep immutable. Jika component mutable, tetap perlu defensive copy.

---

### 3.5 Enum cocok untuk variant tanpa payload kompleks

Jika semua variant tidak punya payload berbeda, enum tetap lebih sederhana:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    APPROVED,
    REJECTED
}
```

Jika setiap variant mulai punya data berbeda, sealed hierarchy lebih kuat:

```java
public sealed interface CaseDecision permits Approved, Rejected, ReturnedForClarification {}

public record Approved(String approvalNo) implements CaseDecision {}
public record Rejected(String reasonCode, String explanation) implements CaseDecision {}
public record ReturnedForClarification(String requestedInfo) implements CaseDecision {}
```

Rule of thumb:

```text
enum
    closed set of names

sealed hierarchy
    closed set of shapes
```

---

## 4. Syntax dan Struktur Dasar

### 4.1 Sealed class

```java
public sealed abstract class DocumentCommand
        permits CreateDocument,
                UpdateDocument,
                DeleteDocument {
}

public final class CreateDocument extends DocumentCommand {}
public final class UpdateDocument extends DocumentCommand {}
public final class DeleteDocument extends DocumentCommand {}
```

`DocumentCommand` dapat berupa class abstract, concrete, atau interface.

---

### 4.2 Sealed interface

```java
public sealed interface DomainEvent
        permits CaseCreated,
                CaseAssigned,
                CaseClosed {
}

public record CaseCreated(String caseId) implements DomainEvent {}
public record CaseAssigned(String caseId, String officerId) implements DomainEvent {}
public record CaseClosed(String caseId, String reason) implements DomainEvent {}
```

Sealed interface sering menjadi pilihan terbaik untuk modelling variant karena Java tidak punya multiple class inheritance, tetapi class/record bisa implement interface.

---

### 4.3 Implicit permits untuk nested classes

Jika permitted classes dideklarasikan sebagai nested classes di dalam sealed type, `permits` sering dapat dihilangkan karena compiler dapat menginfer.

```java
public sealed interface ApiResult {
    record Ok(String body) implements ApiResult {}
    record NotFound(String resource) implements ApiResult {}
    record Failure(String code, String message) implements ApiResult {}
}
```

Kelebihan:

- semua variant dekat dengan root type;
- public API lebih mudah dibaca;
- ownership jelas;
- cocok untuk result kecil.

Kekurangan:

- file bisa terlalu besar;
- variant besar lebih susah dipelihara;
- nested naming bisa panjang;
- beberapa framework mapping lebih nyaman dengan top-level classes.

---

### 4.4 `non-sealed` sebagai escape hatch

```java
public sealed interface NotificationChannel permits EmailChannel, ExtensibleChannel {}

public final class EmailChannel implements NotificationChannel {}

public non-sealed interface ExtensibleChannel extends NotificationChannel {}

public final class SlackChannel implements ExtensibleChannel {}
public final class TeamsChannel implements ExtensibleChannel {}
```

Ini artinya root hierarchy dikontrol, tetapi satu cabang sengaja dibuka.

Desain ini berguna ketika kamu ingin membedakan:

```text
platform-owned variants
vs
extension-owned variants
```

Namun hati-hati: begitu cabang `non-sealed` dibuka, exhaustiveness atas root menjadi lebih lemah jika handler harus memahami semua descendant concrete.

---

## 5. Runtime API: `Class::isSealed` dan `Class::getPermittedSubclasses`

### 5.1 Basic introspection

```java
public final class SealedIntrospectionDemo {
    public static void main(String[] args) {
        inspect(ApiResponse.class);
        inspect(String.class);
        inspect(int.class);
        inspect(String[].class);
    }

    static void inspect(Class<?> type) {
        System.out.println("Type: " + type.getName());
        System.out.println("isSealed: " + type.isSealed());

        for (Class<?> permitted : type.getPermittedSubclasses()) {
            System.out.println("  permits: " + permitted.getName());
        }
    }
}

sealed interface ApiResponse permits ApiResponse.Ok, ApiResponse.Error {
    record Ok(String body) implements ApiResponse {}
    record Error(String code) implements ApiResponse {}
}
```

Output conceptually:

```text
Type: ApiResponse
isSealed: true
  permits: ApiResponse$Ok
  permits: ApiResponse$Error

Type: java.lang.String
isSealed: false

Type: int
isSealed: false

Type: [Ljava.lang.String;
isSealed: false
```

Catatan penting:

- array bukan sealed;
- primitive bukan sealed;
- normal final class seperti `String` bukan sealed;
- `final` dan `sealed` adalah konsep berbeda.

---

### 5.2 Jangan menganggap permitted subclasses sudah semua concrete leaves

```java
sealed interface Rule permits BuiltInRule, ExtensionRule {}

sealed interface BuiltInRule extends Rule permits MaxAmountRule, CountryRule {}

record MaxAmountRule(long amount) implements BuiltInRule {}
record CountryRule(String country) implements BuiltInRule {}

non-sealed interface ExtensionRule extends Rule {}
```

Jika kamu panggil:

```java
Rule.class.getPermittedSubclasses();
```

Yang terlihat:

```text
BuiltInRule
ExtensionRule
```

Bukan:

```text
MaxAmountRule
CountryRule
some unknown ExtensionRule implementation
```

Untuk mendapatkan semua sealed leaves, kamu perlu traversal recursive, dan tetap tidak bisa menutup cabang `non-sealed`.

---

### 5.3 Recursive sealed tree collector

```java
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.List;

public final class SealedTrees {
    private SealedTrees() {}

    public static List<Class<?>> knownLeavesOf(Class<?> root) {
        List<Class<?>> leaves = new ArrayList<>();
        collect(root, leaves);
        return List.copyOf(leaves);
    }

    private static void collect(Class<?> type, List<Class<?>> leaves) {
        if (!type.isSealed()) {
            leaves.add(type);
            return;
        }

        Class<?>[] permitted = type.getPermittedSubclasses();

        if (permitted.length == 0) {
            leaves.add(type);
            return;
        }

        for (Class<?> child : permitted) {
            collect(child, leaves);
        }
    }
}
```

Tetapi ada masalah konseptual:

```java
non-sealed interface ExtensionRule extends Rule {}
```

`ExtensionRule` bukan sealed, sehingga collector akan memasukkannya sebagai “leaf known boundary”, bukan concrete final leaf.

Lebih akurat menamai hasilnya:

```java
knownClosedBoundaryTypes(root)
```

bukan:

```java
allSubtypes(root)
```

---

### 5.4 Runtime validation untuk sealed root

Contoh use case: memastikan command bus hanya menerima sealed command root yang kita kontrol.

```java
public final class CommandRegistry {
    private final Class<?> commandRoot;

    public CommandRegistry(Class<?> commandRoot) {
        if (!commandRoot.isSealed()) {
            throw new IllegalArgumentException(
                    "Command root must be sealed: " + commandRoot.getName());
        }
        this.commandRoot = commandRoot;
    }

    public void printPermittedCommands() {
        for (Class<?> type : commandRoot.getPermittedSubclasses()) {
            System.out.println(type.getName());
        }
    }
}
```

Ini tidak menggantikan compile-time checks, tetapi berguna untuk framework internal.

---

## 6. Evolusi Java 8–25

### 6.1 Java 8–14

Sebelum sealed types, Java tidak punya language-level closed hierarchy.

Alternatif umum:

1. `final` class;
2. package-private constructors;
3. private nested classes;
4. enum;
5. visitor pattern;
6. convention/documentation;
7. framework-specific annotations.

Masalahnya, compiler tidak memahami “daftar subtype yang sah” secara formal.

---

### 6.2 Java 15–16 preview

Sealed classes muncul sebagai preview feature sebelum final.

Implikasi untuk codebase modern:

- jangan target Java 15/16 preview API sebagai production baseline hari ini;
- jika menemukan legacy code dengan preview sealed syntax, migrasi ke Java 17+ final syntax/behavior;
- build flags preview tidak boleh menjadi requirement tanpa alasan kuat.

---

### 6.3 Java 17 final

Sealed classes/interfaces menjadi final feature di Java 17 melalui JEP 409.

Ini penting karena Java 17 adalah LTS yang sangat umum di enterprise.

Mulai titik ini, sealed types bisa dianggap production-grade language feature.

---

### 6.4 Java 21–25: sealed + records + pattern matching ecosystem

Sealed types menjadi lebih kuat ketika digabung dengan fitur modern:

- records;
- pattern matching for `instanceof`;
- pattern matching for `switch`;
- record patterns;
- unnamed variables/pattern-related improvements;
- exhaustive switch reasoning.

Contoh modern:

```java
static String render(ApiResult result) {
    return switch (result) {
        case ApiResult.Ok(String body) -> body;
        case ApiResult.NotFound(String resource) -> "Not found: " + resource;
        case ApiResult.Failure(String code, String message) -> code + ": " + message;
    };
}

sealed interface ApiResult {
    record Ok(String body) implements ApiResult {}
    record NotFound(String resource) implements ApiResult {}
    record Failure(String code, String message) implements ApiResult {}
}
```

Di Java 8, model seperti ini biasanya dibuat dengan visitor, enum + fields, atau if-else chain. Di Java 21+, compiler dapat membantu memastikan semua varian ditangani.

Untuk seri ini, fokus kita tetap pada `java.lang` runtime view, tetapi kamu perlu memahami sealed types sebagai bagian dari ekosistem Java modern.

---

## 7. Sealed Types dan Exhaustiveness

### 7.1 Exhaustiveness adalah alasan besar memakai sealed

Dengan closed hierarchy, compiler bisa tahu semua direct permitted variants.

Contoh:

```java
sealed interface Decision permits Approved, Rejected, Escalated {}

record Approved(String approvalNo) implements Decision {}
record Rejected(String reason) implements Decision {}
record Escalated(String queue) implements Decision {}
```

Handler:

```java
static String label(Decision decision) {
    return switch (decision) {
        case Approved a -> "Approved " + a.approvalNo();
        case Rejected r -> "Rejected " + r.reason();
        case Escalated e -> "Escalated to " + e.queue();
    };
}
```

Tidak perlu `default` jika compiler dapat membuktikan semua kemungkinan tertutup.

Manfaatnya besar:

- ketika variant baru ditambahkan, compiler memaksa handler diperbarui;
- business rule tidak diam-diam fallback ke default yang salah;
- state transitions lebih eksplisit;
- refactoring lebih aman.

---

### 7.2 Default branch bisa melemahkan exhaustiveness

Bandingkan:

```java
static String label(Decision decision) {
    return switch (decision) {
        case Approved a -> "Approved";
        default -> "Other";
    };
}
```

Ini compile, tetapi kehilangan manfaat utama sealed.

Jika besok ditambahkan:

```java
record Withdrawn(String actor) implements Decision {}
```

Handler di atas tetap compile dan silently masuk `default`.

Untuk business-critical domain, ini berbahaya.

Rule praktis:

```text
Untuk sealed domain state/result, hindari default branch kecuali benar-benar ada semantic fallback yang valid.
```

---

### 7.3 Exhaustiveness bukan validasi domain

Exhaustive switch memastikan semua shape ditangani.

Ia tidak memastikan isi data valid.

```java
record Approved(String approvalNo) implements Decision {
    Approved {
        if (approvalNo == null || approvalNo.isBlank()) {
            throw new IllegalArgumentException("approvalNo must not be blank");
        }
    }
}
```

Sealed menjawab:

```text
variant apa saja yang mungkin?
```

Constructor invariant menjawab:

```text
apakah data varian ini valid?
```

Keduanya perlu dipakai bersama.

---

## 8. Sealed Types untuk Domain Modelling

### 8.1 Modelling result tanpa nullable ambiguity

Desain buruk:

```java
public final class LookupResult {
    private User user;
    private String errorCode;
    private boolean found;
}
```

Masalah:

- `found=true` tapi `user=null`;
- `found=false` tapi `errorCode=null`;
- error dan not found dicampur;
- caller perlu memahami kombinasi field implisit.

Desain sealed:

```java
public sealed interface LookupResult permits LookupResult.Found,
                                              LookupResult.NotFound,
                                              LookupResult.Failed {

    record Found(User user) implements LookupResult {
        public Found {
            if (user == null) throw new IllegalArgumentException("user is required");
        }
    }

    record NotFound(String lookupKey) implements LookupResult {}

    record Failed(String code, String message) implements LookupResult {}
}
```

Sekarang state invalid sulit dibuat.

---

### 8.2 Modelling workflow state dengan data berbeda

Enum cocok untuk state name:

```java
enum CaseState {
    DRAFT,
    SUBMITTED,
    ASSIGNED,
    CLOSED
}
```

Tetapi jika setiap state punya data wajib berbeda:

```java
public sealed interface CaseSnapshot permits DraftCase,
                                             SubmittedCase,
                                             AssignedCase,
                                             ClosedCase {}

public record DraftCase(String caseId, String creatorId) implements CaseSnapshot {}

public record SubmittedCase(String caseId,
                            String submissionNo,
                            Instant submittedAt) implements CaseSnapshot {}

public record AssignedCase(String caseId,
                           String officerId,
                           Instant assignedAt) implements CaseSnapshot {}

public record ClosedCase(String caseId,
                         String outcome,
                         Instant closedAt) implements CaseSnapshot {}
```

Ini membuat model lebih jujur:

```text
Draft tidak punya officer.
Closed wajib punya outcome.
Submitted wajib punya submission timestamp.
```

Daripada membuat satu class penuh nullable fields:

```java
class CaseSnapshot {
    String caseId;
    String creatorId;
    String submissionNo; // nullable depending state
    String officerId;    // nullable depending state
    String outcome;      // nullable depending state
}
```

Sealed hierarchy mengurangi “invalid combinations”.

---

### 8.3 Modelling command dengan ownership jelas

```java
public sealed interface CaseCommand permits SubmitCase,
                                           AssignCase,
                                           CloseCase,
                                           ReopenCase {}

public record SubmitCase(String caseId, String actorId) implements CaseCommand {}
public record AssignCase(String caseId, String officerId) implements CaseCommand {}
public record CloseCase(String caseId, String outcomeCode) implements CaseCommand {}
public record ReopenCase(String caseId, String reason) implements CaseCommand {}
```

Command handler:

```java
public final class CaseCommandHandler {
    public void handle(CaseCommand command) {
        switch (command) {
            case SubmitCase c -> submit(c);
            case AssignCase c -> assign(c);
            case CloseCase c -> close(c);
            case ReopenCase c -> reopen(c);
        }
    }

    private void submit(SubmitCase c) {}
    private void assign(AssignCase c) {}
    private void close(CloseCase c) {}
    private void reopen(ReopenCase c) {}
}
```

Saat command baru ditambahkan, handler dipaksa diperbarui.

---

### 8.4 Modelling failure taxonomy

```java
public sealed interface ServiceFailure permits ValidationFailure,
                                               AuthorizationFailure,
                                               DependencyFailure,
                                               ConflictFailure {}

public record ValidationFailure(List<String> errors) implements ServiceFailure {}
public record AuthorizationFailure(String permission) implements ServiceFailure {}
public record DependencyFailure(String dependency, String reason) implements ServiceFailure {}
public record ConflictFailure(String resource, String reason) implements ServiceFailure {}
```

Mapping ke API response:

```java
static int httpStatus(ServiceFailure failure) {
    return switch (failure) {
        case ValidationFailure ignored -> 400;
        case AuthorizationFailure ignored -> 403;
        case ConflictFailure ignored -> 409;
        case DependencyFailure ignored -> 503;
    };
}
```

Ini lebih defensible daripada stringly-typed error code yang tersebar.

---

## 9. Sealed Types vs Enum vs Class Hierarchy vs Visitor

### 9.1 Sealed vs enum

| Kebutuhan | Enum | Sealed hierarchy |
|---|---:|---:|
| Closed set of names | Sangat cocok | Bisa, tapi berlebihan |
| Variant punya payload berbeda | Lemah | Sangat cocok |
| Variant punya behavior berbeda | Bisa | Bisa |
| Perlu exhaustive switch | Bisa | Sangat cocok |
| External code stable | Bisa dengan field code | Bisa tapi perlu mapping |
| Banyak variant sederhana | Cocok | Bisa terlalu verbose |

Contoh enum lebih baik:

```java
public enum Priority {
    LOW,
    MEDIUM,
    HIGH
}
```

Contoh sealed lebih baik:

```java
sealed interface AuthenticationResult permits Success, MfaRequired, Locked, Failed {}

record Success(String userId) implements AuthenticationResult {}
record MfaRequired(String challengeId) implements AuthenticationResult {}
record Locked(Instant until) implements AuthenticationResult {}
record Failed(String reason) implements AuthenticationResult {}
```

---

### 9.2 Sealed vs visitor pattern

Sebelum pattern matching switch, visitor pattern sering dipakai untuk closed hierarchy:

```java
interface Expr {
    <R> R accept(ExprVisitor<R> visitor);
}
```

Kelebihan visitor:

- bisa enforce operation handling;
- bekerja di Java lama;
- cocok untuk AST/compilers.

Kekurangan:

- verbose;
- sulit untuk domain biasa;
- menambah operation baru bisa memaksa perubahan visitor;
- boilerplate tinggi.

Sealed + switch modern sering lebih sederhana:

```java
static int eval(Expr expr) {
    return switch (expr) {
        case Expr.Lit(int value) -> value;
        case Expr.Add(var left, var right) -> eval(left) + eval(right);
    };
}
```

Namun untuk Java 8–16, visitor masih relevan jika ingin closed-ish hierarchy.

---

### 9.3 Sealed vs package-private constructors

Sebelum sealed:

```java
public abstract class Token {
    Token() {}
}
```

Subtype hanya bisa dibuat di package yang sama.

Masalah:

- compiler tidak tahu daftar subtype lengkap;
- package bisa berisi class lain;
- public API tidak menyatakan permitted set;
- runtime reflection tidak punya metadata sealed formal.

Sealed lebih eksplisit:

```java
public sealed abstract class Token permits IdentifierToken, NumberToken, SymbolToken {}
```

---

## 10. Module dan Package Constraint

### 10.1 Kenapa constraint ini ada?

Sealed hierarchy tidak dimaksudkan tersebar lintas maintenance domain. Root type harus tahu permitted direct subclasses, dan subclasses harus merujuk root type.

Akibatnya, Java membatasi lokasi permitted direct subclasses:

- jika root sealed type berada dalam named module, permitted direct subclasses harus berada dalam module yang sama;
- jika berada dalam unnamed module, permitted direct subclasses harus berada dalam package yang sama.

Ini penting untuk desain library.

---

### 10.2 Implikasi untuk public API

Misalnya kamu ingin:

```text
com.example.api.PaymentResult
com.example.impl.SuccessPaymentResult
com.example.impl.FailedPaymentResult
```

Jika tidak memakai named module dan root berada di package berbeda dari implementasi, desain sealed seperti itu bermasalah.

Solusi:

1. jadikan variants nested di root;
2. letakkan variants dalam package yang sama;
3. gunakan named module dengan packages berbeda tetapi module sama;
4. jangan gunakan sealed jika extension lintas package memang requirement;
5. buka cabang `non-sealed` untuk extension.

---

### 10.3 Nested variants sering paling bersih untuk API kecil

```java
package com.example.api;

public sealed interface PaymentResult {
    record Success(String paymentId) implements PaymentResult {}
    record Declined(String code) implements PaymentResult {}
    record Pending(String reference) implements PaymentResult {}
}
```

Kelebihan:

- satu maintenance unit;
- permits implicit;
- public API jelas;
- package/module constraint sederhana.

Kekurangan:

- semua variant menjadi bagian dari public nested API;
- tidak ideal untuk variant dengan logic besar.

---

## 11. Binary Compatibility dan API Evolution

### 11.1 Menambahkan permitted subtype adalah breaking secara source/semantic

Misalnya versi 1:

```java
public sealed interface Decision permits Approved, Rejected {}
```

Client punya switch exhaustive:

```java
return switch (decision) {
    case Approved a -> ...;
    case Rejected r -> ...;
};
```

Versi 2:

```java
public sealed interface Decision permits Approved, Rejected, Escalated {}
```

Secara domain, client harus menangani `Escalated`. Ini sering menjadi source compatibility break karena switch exhaustive lama tidak lagi complete saat recompile.

Itu bukan bug. Itu justru manfaat sealed.

Tapi untuk public library, ini harus dianggap perubahan API serius.

---

### 11.2 Menghapus permitted subtype juga breaking

Jika kamu menghapus subtype:

```java
record Rejected(String reason) implements Decision {}
```

Client yang memakai `Rejected` akan gagal compile atau runtime linkage depending deployment.

---

### 11.3 Mengubah `sealed` menjadi `non-sealed` atau sebaliknya

Perubahan hierarchy policy memengaruhi downstream code.

Contoh:

```java
public sealed interface Rule permits BuiltInRule {}
```

Menjadi:

```java
public non-sealed interface Rule {}
```

Dampaknya:

- compiler tidak bisa lagi membuktikan exhaustiveness;
- switch client bisa butuh default;
- domain guarantee melemah.

Sebaliknya, mengubah interface terbuka menjadi sealed dapat mematahkan implementor eksternal.

---

### 11.4 Public sealed hierarchy perlu versioning discipline

Checklist saat sealed type menjadi public API:

1. Apakah variant set benar-benar stabil?
2. Apakah client diharapkan exhaustive switch?
3. Apakah external implementor harus diizinkan?
4. Apakah ada “unknown/future” variant?
5. Apakah subtype baru nanti akan dianggap major version change?
6. Apakah serialization format sudah siap untuk new variant?
7. Apakah JSON/XML mapping punya discriminator yang stabil?
8. Apakah module/package placement sudah sustainable?

Jika jawabannya tidak jelas, sealed public API mungkin terlalu agresif.

---

## 12. Sealed Types dan Frameworks

### 12.1 Serialization/deserialization

Sealed hierarchy sering dipakai untuk polymorphic DTO:

```java
sealed interface Message permits TextMessage, ImageMessage {}
record TextMessage(String text) implements Message {}
record ImageMessage(String url) implements Message {}
```

Masalah muncul saat deserialization:

- format perlu discriminator;
- subtype harus diketahui serializer;
- constructor/record component harus bisa dipanggil;
- unknown subtype dari payload harus ditangani;
- compatibility saat variant baru ditambahkan harus jelas.

Safe format biasanya menyimpan explicit type code, bukan Java class name:

```json
{
  "type": "TEXT",
  "text": "hello"
}
```

Hindari menjadikan fully qualified class name sebagai external protocol kecuali benar-benar controlled internal format.

---

### 12.2 ORM/JPA style entity modelling

Sealed classes bisa bermasalah dengan ORM yang butuh:

- proxy subclass;
- no-arg constructor;
- lazy loading;
- bytecode enhancement;
- inheritance mapping tertentu.

Contoh masalah:

```java
public sealed abstract class CaseEntity permits OpenCaseEntity, ClosedCaseEntity {}
```

Jika ORM perlu membuat proxy subclass dari `OpenCaseEntity`, tetapi `OpenCaseEntity` final, proxy gagal.

Untuk persistence entity, sealed tidak otomatis salah, tetapi perlu testing dengan provider/framework nyata.

Rule praktis:

```text
Gunakan sealed lebih nyaman untuk domain model/DTO/result/command,
bukan selalu untuk ORM entity yang diproxy.
```

---

### 12.3 DI dan AOP proxies

Framework DI/AOP sering membuat proxy dengan:

- subclass proxy;
- interface proxy;
- bytecode generation;
- dynamic class loading.

Jika class sealed/final, subclass proxy bisa gagal.

Solusi:

1. gunakan interface-based proxy;
2. pisahkan sealed domain model dari service beans;
3. jangan sealed class yang harus diproxy;
4. gunakan composition daripada inheritance;
5. test native image/bytecode mode jika relevan.

---

### 12.4 Plugin architecture

Sealed root tidak cocok jika pihak luar harus menambah implementation bebas.

Buruk:

```java
public sealed interface PaymentProvider permits StripeProvider, PaypalProvider {}
```

Jika third-party harus menambah provider, sealed menutup extension.

Lebih baik:

```java
public sealed interface PaymentProvider permits BuiltInPaymentProvider,
                                               ExternalPaymentProvider {}

public sealed interface BuiltInPaymentProvider extends PaymentProvider
        permits StripeProvider, PaypalProvider {}

public non-sealed interface ExternalPaymentProvider extends PaymentProvider {}
```

Ini menjaga built-in taxonomy tetap diketahui, sambil menyediakan extension point.

---

## 13. Sealed Types dan Pattern Matching

### 13.1 Pattern matching for `instanceof`

```java
if (result instanceof LookupResult.Found found) {
    return found.user();
}
```

Ini bukan sealed-specific, tetapi sealed membuat daftar kemungkinan lebih terkendali.

---

### 13.2 Pattern matching switch

```java
static String describe(LookupResult result) {
    return switch (result) {
        case LookupResult.Found found -> "Found " + found.user().id();
        case LookupResult.NotFound nf -> "Missing " + nf.lookupKey();
        case LookupResult.Failed failed -> "Failed " + failed.code();
    };
}
```

Ini adalah salah satu payoff terbesar sealed hierarchy.

---

### 13.3 Record patterns

Dengan record variants, destructuring bisa membuat handler lebih langsung:

```java
static String describe(LookupResult result) {
    return switch (result) {
        case LookupResult.Found(User(String id, String name)) -> "Found " + name;
        case LookupResult.NotFound(String key) -> "Missing " + key;
        case LookupResult.Failed(String code, String message) -> code + ": " + message;
    };
}
```

Catatan: pattern matching dan record patterns memiliki evolusi antar versi Java modern. Saat menulis library yang harus support Java 8/11/17, jangan menggunakan syntax ini di source utama kecuali baseline runtime/compiler memang mendukung.

---

## 14. Designing Sealed Hierarchies Correctly

### 14.1 Mulai dari domain question

Jangan mulai dari syntax.

Tanyakan:

1. Apa konsep root-nya?
2. Apakah variasinya benar-benar terbatas?
3. Apakah setiap variasi punya data/invariant berbeda?
4. Apakah caller perlu exhaustive handling?
5. Apakah pihak luar perlu menambah variasi?
6. Apakah hierarchy ini public API atau internal?
7. Bagaimana variant baru akan dirilis?
8. Bagaimana persistence/serialization menangani variant?

Jika variasi sering berubah oleh konfigurasi/customer/plugin, sealed mungkin salah.

---

### 14.2 Root type sebaiknya merepresentasikan konsep stabil

Baik:

```java
sealed interface AuthenticationResult permits Authenticated, MfaRequired, Denied {}
```

Konsep `AuthenticationResult` stabil.

Kurang baik:

```java
sealed interface CustomerSpecificReportType permits ReportA, ReportB, ReportC {}
```

Jika report type sering ditambah customer, hierarchy akan sering berubah.

---

### 14.3 Hindari hierarchy terlalu dalam

Terlalu banyak level membuat reasoning sulit:

```text
Decision
  PositiveDecision
    AutoApproved
    ManuallyApproved
  NegativeDecision
    Rejected
    Declined
  PendingDecision
    AwaitingOfficer
    AwaitingPayment
```

Kadang lebih baik flat:

```java
sealed interface Decision permits AutoApproved,
                                  ManuallyApproved,
                                  Rejected,
                                  AwaitingOfficer,
                                  AwaitingPayment {}
```

Atau gunakan field classification di variant.

Rule praktis:

```text
Hierarchy depth harus mengikuti invariant nyata,
bukan sekadar taxonomy cantik.
```

---

### 14.4 Jangan membuat subtype hanya untuk label

Buruk:

```java
sealed interface Priority permits LowPriority, MediumPriority, HighPriority {}
record LowPriority() implements Priority {}
record MediumPriority() implements Priority {}
record HighPriority() implements Priority {}
```

Jika tidak ada payload/behavior berbeda, enum lebih baik:

```java
enum Priority { LOW, MEDIUM, HIGH }
```

---

### 14.5 Gunakan invariant di variant constructor

```java
public record Escalated(String queue, String reason) implements Decision {
    public Escalated {
        if (queue == null || queue.isBlank()) {
            throw new IllegalArgumentException("queue is required");
        }
        if (reason == null || reason.isBlank()) {
            throw new IllegalArgumentException("reason is required");
        }
    }
}
```

Sealed membatasi shape. Constructor menjaga validitas isi.

---

## 15. Failure Modes

### 15.1 Over-sealing

Gejala:

- setiap perubahan bisnis butuh ubah root permits;
- consumer sering recompile karena variant berubah;
- plugin/extension tidak bisa berkembang;
- hierarchy terasa seperti config yang dikodekan keras.

Solusi:

- gunakan enum/config registry jika variant dynamic;
- gunakan `non-sealed` extension branch;
- jadikan sealed hanya untuk internal core variants;
- bedakan stable taxonomy vs customer-specific variations.

---

### 15.2 Menggunakan sealed sebagai security boundary

Salah:

```java
// Karena sealed, saya percaya semua object aman.
void approve(ApprovalCommand command) { ... }
```

Masalah:

- object masih bisa punya data invalid jika constructor buruk;
- payload bisa berasal dari deserialization tidak trusted;
- authorization tetap perlu dicek;
- reflection/framework bisa memengaruhi instantiation depending environment;
- sealed tidak menggantikan permission model.

Solusi:

- tetap validate command;
- tetap authorize actor;
- tetap sanitize external input;
- tetap pakai module/package encapsulation;
- jangan expose constructors/factories sembarangan.

---

### 15.3 Default branch yang menyembunyikan variant baru

```java
return switch (failure) {
    case ValidationFailure v -> 400;
    default -> 500;
};
```

Jika variant baru `AuthorizationFailure` ditambahkan, mapping diam-diam jadi 500.

Solusi:

- hindari `default` pada sealed switch domain-critical;
- biarkan compiler memaksa exhaustiveness;
- jika perlu fallback, dokumentasikan semantic-nya.

---

### 15.4 Menyimpan class name sebagai external discriminator

Buruk:

```json
{
  "class": "com.company.internal.payment.SuccessPayment",
  "paymentId": "P-1"
}
```

Masalah:

- refactoring package/class merusak protocol;
- membuka internal implementation detail;
- meningkatkan attack surface deserialization;
- coupling client ke JVM class model.

Lebih baik:

```json
{
  "type": "SUCCESS",
  "paymentId": "P-1"
}
```

---

### 15.5 Sealed entity yang perlu diproxy

Jika framework perlu subclass proxy, sealed/final dapat mematahkan runtime behavior.

Solusi:

- hindari sealed pada class yang harus diproxy;
- gunakan sealed DTO/domain snapshot terpisah dari persistence entity;
- gunakan interface projection;
- test dengan framework runtime, bukan hanya compile.

---

### 15.6 Salah menganggap `getPermittedSubclasses()` menemukan semua subtype

`getPermittedSubclasses()` bukan classpath scanner.

Ia tidak mencari semua implementation. Ia hanya membaca permitted direct subclasses dari sealed type.

Jika ada cabang `non-sealed`, subtype di bawahnya tidak akan muncul otomatis.

---

## 16. Performance, Memory, dan Runtime Cost

### 16.1 Sealed modifier sendiri bukan performance feature

Sealed types bukan mekanisme optimasi utama yang harus kamu andalkan.

Compiler/JVM mungkin bisa memanfaatkan informasi hierarchy dalam beberapa konteks, tetapi desain sealed sebaiknya didorong oleh:

- correctness;
- modelling clarity;
- exhaustiveness;
- API governance;
- maintainability.

Bukan klaim “lebih cepat”.

---

### 16.2 Runtime reflection cost kecil, tapi jangan di hot path tanpa cache

```java
Class<?>[] permitted = root.getPermittedSubclasses();
```

Ini bukan operasi bisnis mahal, tetapi jika dipanggil berulang pada hot path request, cache hasilnya.

Contoh:

```java
public final class SealedMetadata {
    private static final ClassValue<List<Class<?>>> PERMITTED = new ClassValue<>() {
        @Override
        protected List<Class<?>> computeValue(Class<?> type) {
            return List.of(type.getPermittedSubclasses());
        }
    };

    public static List<Class<?>> permittedSubclassesOf(Class<?> type) {
        return PERMITTED.get(type);
    }
}
```

`ClassValue` cocok karena metadata melekat pada `Class` dan lebih ramah terhadap class loader daripada static global map biasa.

---

### 16.3 Sealed + records bisa mengurangi accidental state complexity

Performance terbesar sering bukan CPU, tetapi pengurangan bug:

- lebih sedikit nullable combinations;
- lebih sedikit invalid state;
- lebih mudah test exhaustive cases;
- lebih jelas serialization variant;
- lebih mudah refactor command/result handling.

Dalam production system, clarity sering memberi manfaat operasional lebih besar daripada micro-optimization.

---

## 17. Compatibility dengan Java 8–25

### 17.1 Jika source harus support Java 8

Tidak bisa memakai syntax sealed.

Alternatif:

1. enum jika payload tidak berbeda;
2. visitor pattern;
3. abstract class dengan package-private constructor;
4. nested final subclasses;
5. documentation + tests;
6. annotation processor/custom lint;
7. separate Java 17+ module/source set.

Contoh Java 8 compatible:

```java
public abstract class Result {
    private Result() {}

    public static final class Success extends Result {
        private final String value;
        public Success(String value) { this.value = value; }
        public String value() { return value; }
    }

    public static final class Failure extends Result {
        private final String message;
        public Failure(String message) { this.message = message; }
        public String message() { return message; }
    }
}
```

Constructor private di root membatasi subclass hanya nested classes.

Kekurangan:

- tidak ada `isSealed`;
- tidak ada `getPermittedSubclasses`;
- tidak ada compiler exhaustiveness modern;
- lebih verbose.

---

### 17.2 Multi-version strategy

Jika library ingin support Java 8 dan Java 17+, opsi:

1. tetap pakai Java 8-compatible modelling di main artifact;
2. buat artifact modern terpisah;
3. gunakan multi-release JAR untuk API tambahan dengan sangat hati-hati;
4. gunakan adapter layer;
5. jangan expose sealed types di API jika baseline masih Java 8.

Rule praktis:

```text
Kalau public artifact harus berjalan di Java 8,
jangan jadikan sealed types sebagai public contract utama.
```

---

### 17.3 Internal service Java 21/25

Jika kamu mengontrol runtime internal service dan baseline Java 21/25, sealed sangat layak untuk:

- command model;
- query result;
- domain event;
- validation result;
- failure taxonomy;
- workflow transition result;
- parser event;
- import/export result.

---

## 18. Production Checklist

Gunakan checklist ini sebelum memakai sealed type di production.

### 18.1 Domain fit

- [ ] Variant set benar-benar terbatas secara domain.
- [ ] Caller perlu exhaustive handling.
- [ ] Tiap variant punya payload/behavior/invariant berbeda.
- [ ] Variant tidak ditambah secara dinamis oleh config/customer/plugin.
- [ ] Root concept stabil.

### 18.2 API design

- [ ] Root type package/module placement sudah benar.
- [ ] Public API evolution policy jelas.
- [ ] Subtype baru dianggap breaking/major change jika perlu.
- [ ] Tidak ada `default` branch yang menyembunyikan variant baru.
- [ ] External discriminator tidak memakai Java class name.

### 18.3 Runtime/framework

- [ ] Tidak perlu subclass proxy pada sealed/final classes.
- [ ] Serializer/deserializer sudah mendukung variant.
- [ ] Reflection metadata tidak dipanggil berulang tanpa cache di hot path.
- [ ] Native image/AOT behavior sudah diuji jika relevan.
- [ ] Class loader/module boundary sudah dipahami.

### 18.4 Security and validation

- [ ] Constructor/factory menjaga invariant.
- [ ] External input tetap divalidasi.
- [ ] Authorization tetap eksplisit.
- [ ] Deserialization polymorphism dibatasi.
- [ ] Tidak menganggap sealed sebagai security boundary lengkap.

### 18.5 Compatibility

- [ ] Baseline Java mendukung sealed types.
- [ ] Jika support Java 8, tersedia alternatif modelling.
- [ ] Recompile impact dipahami.
- [ ] Binary/source compatibility diuji.
- [ ] Documentation menjelaskan variant semantics.

---

## 19. Latihan / Thought Exercise

### Latihan 1 — Result modelling

Ubah model berikut menjadi sealed hierarchy:

```java
class PaymentResult {
    boolean success;
    String paymentId;
    String errorCode;
    String errorMessage;
    boolean pending;
    String referenceId;
}
```

Pertanyaan:

1. Apa saja variant yang valid?
2. Field mana yang wajib pada tiap variant?
3. Apakah enum cukup?
4. Bagaimana JSON discriminator-nya?
5. Bagaimana handler exhaustive-nya?

---

### Latihan 2 — Workflow state

Untuk lifecycle enforcement case:

```text
Draft -> Submitted -> UnderReview -> Approved/Rejected -> Closed
```

Desain dua alternatif:

1. enum `CaseStatus`;
2. sealed `CaseSnapshot` dengan payload berbeda.

Bandingkan:

- valid state;
- nullable fields;
- persistence complexity;
- API response clarity;
- transition logic;
- future compatibility.

---

### Latihan 3 — Extension branch

Desain sealed root untuk notification channel dengan built-in channel:

- email;
- SMS;
- push notification.

Tetapi sistem juga harus mengizinkan customer menambah custom channel.

Pertanyaan:

1. Mana yang sealed?
2. Mana yang non-sealed?
3. Apa konsekuensi terhadap exhaustive switch?
4. Apakah public API masih defensible?

---

### Latihan 4 — Runtime inspection

Buat utility:

```java
public static void printSealedTree(Class<?> root)
```

Yang mencetak:

```text
Root sealed? true
- VariantA final
- VariantB sealed
  - VariantB1 final
- Extension non-sealed/open boundary
```

Pertanyaan:

1. Bagaimana mendeteksi sealed?
2. Bagaimana mendeteksi final?
3. Bagaimana memperlakukan non-sealed?
4. Kenapa tidak bisa menemukan semua subclass open boundary tanpa classpath scanning?

---

## 20. Ringkasan

Sealed types adalah salah satu fitur Java modern yang paling penting untuk modelling serius, karena ia mengisi ruang di antara `final` dan open inheritance.

Inti pemahamannya:

```text
Sealed type membatasi direct subtype yang sah.
Setiap permitted subtype wajib memilih final, sealed, atau non-sealed.
Runtime dapat membaca sealed metadata lewat java.lang.Class.
Compiler dapat memakai closed hierarchy untuk exhaustive reasoning.
```

Gunakan sealed ketika:

- variasi domain terbatas;
- caller perlu menangani semua kemungkinan;
- tiap variant punya data/invariant berbeda;
- hierarchy dimiliki oleh satu maintenance boundary;
- public API evolution dapat dikontrol.

Hindari sealed ketika:

- extension eksternal bebas adalah requirement;
- variasi berubah karena config/customer/plugin;
- framework butuh subclass proxy;
- baseline masih Java 8;
- kamu hanya butuh daftar nama sederhana yang lebih cocok sebagai enum.

Mental model paling praktis:

```text
enum           = closed set of names
record         = transparent carrier of data
sealed type    = closed set of shapes
switch pattern = exhaustive reasoning over shapes
```

Jika digabung dengan benar, sealed + records + exhaustive switch dapat membuat model domain jauh lebih jujur, lebih aman, dan lebih mudah dipelihara.

---

## 21. Referensi Resmi

- Java SE 25 API — `java.lang.Class`
  - `isSealed()`
  - `getPermittedSubclasses()`
  - https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Class.html
- JEP 409 — Sealed Classes
  - https://openjdk.org/jeps/409
- Oracle Java Language Guide — Sealed Classes and Interfaces
  - https://docs.oracle.com/en/java/javase/17/language/sealed-classes-and-interfaces.html
- Java Language Specification SE 25
  - Classes, interfaces, sealed/non-sealed/final compatibility
  - https://docs.oracle.com/javase/specs/jls/se25/html/index.html

---

## 22. Status Seri

Part ini adalah **Part 10 dari 32**.

Seri **belum selesai**.

Part berikutnya:

**Part 11 — `Throwable`: Exception Object Model, Stack Trace, Causality, Suppression**

File berikutnya:

`11-throwable-exception-object-model-causality-stacktrace-suppression.md`

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./09-record-runtime-contract-value-carrier-api-boundaries.md">⬅️ Part 9 — `Record`: Runtime Contract, Value Carrier Semantics, and API Boundaries</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./11-throwable-exception-object-model-causality-stacktrace-suppression.md">Part 11 — `Throwable`: Exception Object Model, Stack Trace, Causality, Suppression ➡️</a>
</div>
