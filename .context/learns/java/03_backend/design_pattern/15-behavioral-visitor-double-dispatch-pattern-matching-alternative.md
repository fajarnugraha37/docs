# Part 15 — Behavioral Pattern VI: Visitor, Double Dispatch, Pattern Matching Alternative

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> File: `15-behavioral-visitor-double-dispatch-pattern-matching-alternative.md`  
> Scope Java: Java 8 sampai Java 25  
> Fokus: Visitor, double dispatch, operasi lintas tipe, sealed hierarchy, pattern matching, expression problem, dan anti-pattern branching/polymorphism yang salah tempat.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan bukan hanya bisa menulis `Visitor<T>`, tetapi bisa menjawab pertanyaan desain yang lebih penting:

1. Kapan operasi sebaiknya diletakkan di dalam class domain.
2. Kapan operasi sebaiknya dipisah keluar sebagai visitor.
3. Kapan `instanceof` adalah smell.
4. Kapan `instanceof` justru cukup masuk akal.
5. Kapan Java modern `sealed interface` + pattern matching `switch` lebih baik daripada Visitor klasik.
6. Bagaimana memahami double dispatch tanpa menghafal istilahnya.
7. Bagaimana mengelola domain hierarchy yang tertutup.
8. Bagaimana mengelola operasi yang sering bertambah.
9. Bagaimana menghindari Visitor boilerplate hell.
10. Bagaimana menghindari broken encapsulation ketika visitor butuh terlalu banyak detail internal.
11. Bagaimana memilih antara polymorphism, Visitor, Strategy, Specification, pattern matching, dan table-driven dispatch.

Inti dari bagian ini:

```text
Visitor bukan pattern untuk membuat kode terlihat akademis.
Visitor adalah teknik untuk menambahkan operasi baru terhadap struktur tipe yang relatif stabil,
tanpa mengubah class-class tipe tersebut setiap kali operasi baru ditambahkan.
```

Namun sejak Java memiliki sealed classes dan pattern matching, keputusan ini menjadi lebih menarik. Banyak kasus yang dulu memakai Visitor sekarang bisa dibuat lebih sederhana, lebih eksplisit, dan lebih mudah dibaca.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Bayangkan domain regulatory case memiliki beberapa jenis decision:

```text
ApprovalDecision
RejectionDecision
RequestForInfoDecision
EscalationDecision
WithdrawalDecision
```

Untuk setiap decision, sistem butuh beberapa operasi:

```text
render email
render UI timeline
calculate SLA impact
produce audit message
map to API response
validate transition
export report row
generate notification
```

Cara paling sederhana adalah menaruh semua method ke setiap decision:

```java
interface CaseDecision {
    String renderEmail();
    String renderTimelineText();
    SlaImpact calculateSlaImpact();
    AuditMessage toAuditMessage();
    ApiResponse toApiResponse();
    ReportRow toReportRow();
}
```

Masalahnya:

1. Domain object menjadi tahu terlalu banyak tentang email, UI, audit, API, report.
2. Setiap operasi baru memaksa perubahan semua subtype.
3. Banyak dependency teknis masuk ke domain.
4. Class yang awalnya model decision berubah menjadi dumping ground.
5. Unit test domain tercampur test rendering/reporting/mapping.

Alternatif lain adalah membuat service dengan `if instanceof`:

```java
String renderEmail(CaseDecision decision) {
    if (decision instanceof ApprovalDecision approval) {
        return "Approved: " + approval.approvedAt();
    }
    if (decision instanceof RejectionDecision rejection) {
        return "Rejected: " + rejection.reason();
    }
    if (decision instanceof RequestForInfoDecision rfi) {
        return "Request info: " + rfi.dueDate();
    }
    throw new IllegalArgumentException("Unknown decision: " + decision);
}
```

Ini terlihat mudah, tetapi jika pola yang sama muncul di 20 tempat, kamu punya masalah besar:

```text
EmailRenderer
TimelineRenderer
SlaCalculator
AuditMapper
ApiMapper
ReportExporter
NotificationBuilder
```

Masing-masing memiliki branching terhadap tipe yang sama. Jika subtype baru ditambahkan, kamu harus berburu semua branching.

Visitor mencoba menyelesaikan masalah ini dengan cara membuat operasi lintas tipe menjadi eksplisit.

---

## 3. Mental Model

### 3.1 Dua Sumbu Perubahan

Untuk memahami Visitor, pikirkan desain sebagai matriks:

```text
                    Operasi
Tipe Data       Email   Audit   SLA   API   Report
--------------------------------------------------
Approval          ?       ?      ?     ?      ?
Rejection         ?       ?      ?     ?      ?
RequestInfo       ?       ?      ?     ?      ?
Escalation        ?       ?      ?     ?      ?
Withdrawal        ?       ?      ?     ?      ?
```

Ada dua sumbu yang bisa berubah:

1. **Tipe data bertambah**  
   Contoh: `SuspensionDecision`, `RevocationDecision`, `AppealDecision`.

2. **Operasi bertambah**  
   Contoh: export PDF, render mobile timeline, generate compliance summary.

Polymorphism biasa nyaman jika tipe sering bertambah tetapi operasi relatif stabil.

Visitor nyaman jika operasi sering bertambah tetapi tipe relatif stabil.

Pattern matching switch nyaman jika tipe tertutup, operasi lokal, dan kamu ingin eksplisit tanpa boilerplate Visitor.

---

### 3.2 Expression Problem

Visitor berkaitan dengan masalah klasik bernama **Expression Problem**.

Masalahnya begini:

```text
Bagaimana mendesain sistem supaya mudah menambah tipe data baru
dan mudah menambah operasi baru,
tanpa mengubah kode lama,
tanpa kehilangan type safety?
```

Dalam Java OO klasik:

- Menambah subtype mudah.
- Menambah operasi ke semua subtype sulit karena interface harus berubah.

Dalam pendekatan external function / pattern matching:

- Menambah operasi mudah.
- Menambah subtype sulit karena semua switch harus diperbarui.

Visitor adalah kompromi:

- Operasi baru bisa ditambahkan sebagai class visitor baru.
- Tetapi subtype baru tetap memaksa perubahan visitor interface.

Tidak ada solusi gratis. Setiap pilihan hanya memindahkan biaya perubahan.

Top engineer tidak bertanya:

```text
Pattern mana yang paling benar?
```

Tetapi:

```text
Perubahan mana yang paling mungkin terjadi?
Biaya mana yang ingin kita bayar secara eksplisit?
```

---

### 3.3 Dispatch: Siapa Memilih Implementasi?

Java melakukan method dispatch berdasarkan runtime type dari receiver object.

Contoh:

```java
caseDecision.describe();
```

Jika `caseDecision` berisi `ApprovalDecision`, Java memanggil implementasi `ApprovalDecision.describe()`.

Itu single dispatch:

```text
receiver runtime type menentukan method mana yang dipanggil
```

Tetapi kadang kita ingin dispatch berdasarkan dua hal:

```text
jenis object yang dikunjungi
+
jenis operasi/visitor yang mengunjungi
```

Inilah alasan Visitor sering dijelaskan sebagai double dispatch.

---

## 4. Core Concept: Visitor Pattern

### 4.1 Intent

Visitor memisahkan operasi dari object structure.

Dalam bentuk sederhana:

```java
public interface CaseDecision {
    <R> R accept(CaseDecisionVisitor<R> visitor);
}

public interface CaseDecisionVisitor<R> {
    R visitApproval(ApprovalDecision decision);
    R visitRejection(RejectionDecision decision);
    R visitRequestForInfo(RequestForInfoDecision decision);
    R visitEscalation(EscalationDecision decision);
    R visitWithdrawal(WithdrawalDecision decision);
}
```

Setiap subtype mengarahkan visitor ke method yang tepat:

```java
public record ApprovalDecision(
        String caseId,
        String approvedBy,
        Instant approvedAt
) implements CaseDecision {

    @Override
    public <R> R accept(CaseDecisionVisitor<R> visitor) {
        return visitor.visitApproval(this);
    }
}
```

Lalu operasi eksternal dibuat sebagai visitor:

```java
public final class AuditMessageVisitor implements CaseDecisionVisitor<AuditMessage> {

    @Override
    public AuditMessage visitApproval(ApprovalDecision decision) {
        return new AuditMessage(
                decision.caseId(),
                "CASE_APPROVED",
                "Case approved by " + decision.approvedBy(),
                decision.approvedAt()
        );
    }

    @Override
    public AuditMessage visitRejection(RejectionDecision decision) {
        return new AuditMessage(
                decision.caseId(),
                "CASE_REJECTED",
                "Case rejected: " + decision.reason(),
                decision.rejectedAt()
        );
    }

    @Override
    public AuditMessage visitRequestForInfo(RequestForInfoDecision decision) {
        return new AuditMessage(
                decision.caseId(),
                "REQUEST_FOR_INFO",
                "Information requested before " + decision.dueDate(),
                decision.requestedAt()
        );
    }

    @Override
    public AuditMessage visitEscalation(EscalationDecision decision) {
        return new AuditMessage(
                decision.caseId(),
                "CASE_ESCALATED",
                "Case escalated to " + decision.escalationLevel(),
                decision.escalatedAt()
        );
    }

    @Override
    public AuditMessage visitWithdrawal(WithdrawalDecision decision) {
        return new AuditMessage(
                decision.caseId(),
                "CASE_WITHDRAWN",
                "Case withdrawn by " + decision.withdrawnBy(),
                decision.withdrawnAt()
        );
    }
}
```

Usage:

```java
AuditMessage audit = decision.accept(new AuditMessageVisitor());
```

---

### 4.2 Apa yang Dipindahkan oleh Visitor?

Tanpa Visitor:

```text
Operasi tersebar di subtype
atau
branching tersebar di banyak service
```

Dengan Visitor:

```text
Satu operasi lintas tipe dikumpulkan dalam satu class
```

Contoh:

```text
AuditMessageVisitor
EmailRenderingVisitor
SlaImpactVisitor
ApiMappingVisitor
ReportRowVisitor
```

Setiap visitor menjawab satu pertanyaan:

```text
Untuk semua jenis CaseDecision, bagaimana operasi X dilakukan?
```

---

## 5. Double Dispatch Step-by-Step

Misalnya:

```java
CaseDecision decision = new RejectionDecision(...);
CaseDecisionVisitor<String> visitor = new EmailSubjectVisitor();
String subject = decision.accept(visitor);
```

Langkah yang terjadi:

```text
1. Variable decision bertipe CaseDecision.
2. Runtime object sebenarnya adalah RejectionDecision.
3. Java dispatch pertama: panggil RejectionDecision.accept(visitor).
4. Di dalam RejectionDecision.accept, object memanggil visitor.visitRejection(this).
5. Java sekarang memilih method visitRejection berdasarkan tipe compile-time method yang eksplisit.
6. Visitor menjalankan logika operasi untuk RejectionDecision.
```

Kode:

```java
public record RejectionDecision(
        String caseId,
        String reason,
        Instant rejectedAt
) implements CaseDecision {

    @Override
    public <R> R accept(CaseDecisionVisitor<R> visitor) {
        return visitor.visitRejection(this);
    }
}
```

`this` di dalam `RejectionDecision` bertipe `RejectionDecision`, sehingga visitor mendapat tipe konkret tanpa cast.

Itulah trik utamanya.

---

## 6. Visitor Anatomy

Pattern Visitor yang sehat memiliki komponen:

```text
Element interface       : tipe root yang menerima visitor
Concrete element        : subtype yang implement accept
Visitor interface       : kontrak operasi untuk semua subtype
Concrete visitor        : implementasi operasi tertentu
Return type             : hasil operasi
Context input           : data tambahan operasi jika diperlukan
```

Contoh generic visitor:

```java
public interface CaseDecisionVisitor<R> {
    R visitApproval(ApprovalDecision decision);
    R visitRejection(RejectionDecision decision);
    R visitRequestForInfo(RequestForInfoDecision decision);
    R visitEscalation(EscalationDecision decision);
    R visitWithdrawal(WithdrawalDecision decision);
}
```

Jika operasi tidak mengembalikan hasil:

```java
public interface VoidCaseDecisionVisitor {
    void visitApproval(ApprovalDecision decision);
    void visitRejection(RejectionDecision decision);
    void visitRequestForInfo(RequestForInfoDecision decision);
    void visitEscalation(EscalationDecision decision);
    void visitWithdrawal(WithdrawalDecision decision);
}
```

Namun di Java, lebih sering lebih bersih memakai `R` dan mengembalikan object hasil, karena side effect lebih mudah dikontrol.

---

## 7. Visitor dengan Return Type

### 7.1 Visitor yang Menghasilkan String

```java
public final class TimelineTextVisitor implements CaseDecisionVisitor<String> {

    @Override
    public String visitApproval(ApprovalDecision decision) {
        return "Approved by " + decision.approvedBy();
    }

    @Override
    public String visitRejection(RejectionDecision decision) {
        return "Rejected because " + decision.reason();
    }

    @Override
    public String visitRequestForInfo(RequestForInfoDecision decision) {
        return "More information requested by " + decision.dueDate();
    }

    @Override
    public String visitEscalation(EscalationDecision decision) {
        return "Escalated to " + decision.escalationLevel();
    }

    @Override
    public String visitWithdrawal(WithdrawalDecision decision) {
        return "Withdrawn by " + decision.withdrawnBy();
    }
}
```

Usage:

```java
String text = decision.accept(new TimelineTextVisitor());
```

### 7.2 Visitor yang Menghasilkan Domain Object

```java
public record SlaImpact(
        boolean pausesClock,
        boolean resumesClock,
        Duration additionalTime,
        String reason
) {}
```

```java
public final class SlaImpactVisitor implements CaseDecisionVisitor<SlaImpact> {

    @Override
    public SlaImpact visitApproval(ApprovalDecision decision) {
        return new SlaImpact(false, false, Duration.ZERO, "Approval closes SLA tracking");
    }

    @Override
    public SlaImpact visitRejection(RejectionDecision decision) {
        return new SlaImpact(false, false, Duration.ZERO, "Rejection closes SLA tracking");
    }

    @Override
    public SlaImpact visitRequestForInfo(RequestForInfoDecision decision) {
        return new SlaImpact(true, false, Duration.ZERO, "Waiting for applicant input");
    }

    @Override
    public SlaImpact visitEscalation(EscalationDecision decision) {
        return new SlaImpact(false, false, Duration.ofDays(2), "Escalation grants review buffer");
    }

    @Override
    public SlaImpact visitWithdrawal(WithdrawalDecision decision) {
        return new SlaImpact(false, false, Duration.ZERO, "Withdrawal terminates case");
    }
}
```

---

## 8. Visitor dengan Context Parameter

Kadang operasi membutuhkan context tambahan.

Contoh: render email membutuhkan locale, template version, actor, dan feature flags.

Jangan memaksa semua data itu masuk ke domain object.

Buat context object:

```java
public record EmailRenderContext(
        Locale locale,
        String templateVersion,
        String actorDisplayName,
        ZoneId zoneId
) {}
```

Visitor dapat menerima context melalui constructor:

```java
public final class EmailBodyVisitor implements CaseDecisionVisitor<String> {

    private final EmailRenderContext context;

    public EmailBodyVisitor(EmailRenderContext context) {
        this.context = Objects.requireNonNull(context);
    }

    @Override
    public String visitApproval(ApprovalDecision decision) {
        return "Dear applicant, your case " + decision.caseId()
                + " has been approved by " + context.actorDisplayName();
    }

    @Override
    public String visitRejection(RejectionDecision decision) {
        return "Dear applicant, your case " + decision.caseId()
                + " has been rejected. Reason: " + decision.reason();
    }

    @Override
    public String visitRequestForInfo(RequestForInfoDecision decision) {
        return "Please provide additional information by "
                + decision.dueDate().atZone(context.zoneId()).toLocalDate();
    }

    @Override
    public String visitEscalation(EscalationDecision decision) {
        return "Your case has been escalated for further review.";
    }

    @Override
    public String visitWithdrawal(WithdrawalDecision decision) {
        return "Your case has been withdrawn.";
    }
}
```

Usage:

```java
EmailRenderContext context = new EmailRenderContext(
        Locale.ENGLISH,
        "v3",
        "Senior Officer",
        ZoneId.of("Asia/Singapore")
);

String email = decision.accept(new EmailBodyVisitor(context));
```

Design rule:

```text
Context milik operasi masuk ke visitor.
State intrinsic milik decision tetap di decision.
```

---

## 9. Kapan Visitor Cocok?

Visitor cocok jika:

1. Struktur tipe relatif stabil.
2. Operasi terhadap tipe sering bertambah.
3. Operasi tidak natural menjadi responsibility internal object.
4. Kamu ingin mengumpulkan satu operasi lintas subtype dalam satu tempat.
5. Kamu ingin compile-time pressure saat subtype baru ditambahkan.
6. Kamu ingin menghindari `instanceof` tersebar.
7. Domain object tidak boleh bergantung pada layer teknis.

Contoh cocok:

```text
AST compiler/interpreter
rule expression tree
workflow node rendering
case decision export
report row generation
audit message generation
API response mapping
validation summary over heterogeneous nodes
```

Visitor kurang cocok jika:

1. Subtype sering bertambah.
2. Operasi sedikit dan stabil.
3. Setiap subtype sudah secara natural punya behavior itu.
4. Visitor harus membaca terlalu banyak private/internal state.
5. Operasi butuh banyak dependency teknis berat.
6. Hierarchy terbuka untuk plugin eksternal.
7. Kode Java modern bisa memakai sealed + switch lebih sederhana.

---

## 10. Visitor vs Polymorphism Biasa

### 10.1 Polymorphism Biasa

```java
public interface CaseDecision {
    AuditMessage toAuditMessage();
}
```

Kelebihan:

1. Sederhana.
2. Behavior dekat dengan data.
3. Menambah subtype mudah.
4. Tidak ada visitor boilerplate.

Kekurangan:

1. Domain object bisa tercemar operasi eksternal.
2. Operasi baru memaksa perubahan interface.
3. Semua subtype harus berubah saat operasi baru ditambahkan.
4. Bisa menjadi fat domain object.

Gunakan jika operasi adalah responsibility inti object.

Contoh:

```java
public interface Money {
    Money add(Money other);
    Money subtract(Money other);
}
```

`add` adalah behavior natural Money. Jangan pakai Visitor untuk operasi inti seperti ini.

---

### 10.2 Visitor

```java
AuditMessage audit = decision.accept(new AuditMessageVisitor());
```

Kelebihan:

1. Operasi eksternal terpisah.
2. Operasi lintas subtype terkumpul.
3. Menambah operasi baru mudah.
4. Domain tetap bersih dari concern teknis.
5. Compile-time completeness untuk subtype.

Kekurangan:

1. Menambah subtype mahal.
2. Boilerplate tinggi.
3. Bisa melanggar encapsulation.
4. Debugging bisa lebih tidak langsung.
5. Banyak visitor bisa membuat navigation sulit.

Gunakan jika operasi bukan responsibility inti object dan tipe relatif stabil.

---

## 11. Visitor vs Strategy

Strategy memilih algoritma yang bisa diganti.

Visitor memilih operasi berdasarkan tipe object yang dikunjungi.

Contoh Strategy:

```java
public interface PenaltyCalculationStrategy {
    Money calculate(PenaltyInput input);
}
```

Contoh Visitor:

```java
public interface DecisionVisitor<R> {
    R visitApproval(ApprovalDecision decision);
    R visitRejection(RejectionDecision decision);
}
```

Perbedaan mental model:

```text
Strategy:
    “Algoritma mana yang dipakai untuk masalah ini?”

Visitor:
    “Untuk setiap subtype dalam struktur ini, bagaimana operasi ini dilakukan?”
```

Jika variasi terutama berdasarkan policy/configuration, Strategy lebih cocok.

Jika variasi terutama berdasarkan subtype hierarchy, Visitor atau pattern matching lebih cocok.

---

## 12. Visitor vs Specification

Specification menjawab pertanyaan boolean/predicate/domain rule:

```java
boolean isSatisfiedBy(CaseDecision decision);
```

Visitor bisa dipakai untuk implementasi specification jika subtype berbeda perlu rule berbeda.

Contoh:

```java
public final class AppealableDecisionVisitor implements CaseDecisionVisitor<Boolean> {

    @Override
    public Boolean visitApproval(ApprovalDecision decision) {
        return false;
    }

    @Override
    public Boolean visitRejection(RejectionDecision decision) {
        return decision.rejectedAt().isAfter(Instant.now().minus(Duration.ofDays(30)));
    }

    @Override
    public Boolean visitRequestForInfo(RequestForInfoDecision decision) {
        return false;
    }

    @Override
    public Boolean visitEscalation(EscalationDecision decision) {
        return false;
    }

    @Override
    public Boolean visitWithdrawal(WithdrawalDecision decision) {
        return false;
    }
}
```

Tetapi hati-hati: jika semua rule menjadi visitor, kamu mungkin menciptakan class explosion.

---

## 13. Visitor vs Pattern Matching Switch

Java modern memberi alternatif yang sering lebih sederhana:

```java
public static AuditMessage toAuditMessage(CaseDecision decision) {
    return switch (decision) {
        case ApprovalDecision approval -> new AuditMessage(
                approval.caseId(),
                "CASE_APPROVED",
                "Case approved by " + approval.approvedBy(),
                approval.approvedAt()
        );
        case RejectionDecision rejection -> new AuditMessage(
                rejection.caseId(),
                "CASE_REJECTED",
                "Case rejected: " + rejection.reason(),
                rejection.rejectedAt()
        );
        case RequestForInfoDecision rfi -> new AuditMessage(
                rfi.caseId(),
                "REQUEST_FOR_INFO",
                "Information requested before " + rfi.dueDate(),
                rfi.requestedAt()
        );
        case EscalationDecision escalation -> new AuditMessage(
                escalation.caseId(),
                "CASE_ESCALATED",
                "Case escalated to " + escalation.escalationLevel(),
                escalation.escalatedAt()
        );
        case WithdrawalDecision withdrawal -> new AuditMessage(
                withdrawal.caseId(),
                "CASE_WITHDRAWN",
                "Case withdrawn by " + withdrawal.withdrawnBy(),
                withdrawal.withdrawnAt()
        );
    };
}
```

Dengan sealed hierarchy:

```java
public sealed interface CaseDecision
        permits ApprovalDecision,
                RejectionDecision,
                RequestForInfoDecision,
                EscalationDecision,
                WithdrawalDecision {
}
```

Compiler bisa membantu memastikan switch exhaustive.

Ini mengurangi boilerplate `accept(visitor)`.

---

## 14. Sealed Classes sebagai Game Changer

Sebelum sealed class, Java interface biasanya terbuka:

```java
public interface CaseDecision {}
```

Siapa pun bisa membuat implementasi baru.

Visitor interface tidak bisa benar-benar tahu semua subtype secara aman.

Dengan sealed:

```java
public sealed interface CaseDecision permits
        ApprovalDecision,
        RejectionDecision,
        RequestForInfoDecision,
        EscalationDecision,
        WithdrawalDecision {
}
```

Kamu menyatakan:

```text
Hierarchy ini tertutup dan subtype yang valid diketahui.
```

Ini sangat cocok untuk:

```text
domain alternatives
workflow states
decision types
rule expression tree
payment outcome
validation outcome
command result
```

Sealed hierarchy membuat pattern matching switch menjadi alternatif kuat terhadap Visitor.

---

## 15. Visitor Klasik dengan Sealed Hierarchy

Kamu tetap bisa memakai Visitor bersama sealed class.

```java
public sealed interface CaseDecision permits
        ApprovalDecision,
        RejectionDecision,
        RequestForInfoDecision,
        EscalationDecision,
        WithdrawalDecision {

    <R> R accept(CaseDecisionVisitor<R> visitor);
}
```

Kelebihan:

1. Hierarchy tertutup.
2. Visitor interface bisa exhaustive.
3. Compile-time safety lebih kuat.
4. Cocok jika operasi visitor banyak dan reusable.

Kekurangan:

1. Tetap boilerplate.
2. Setiap subtype punya method `accept` repetitif.
3. Pattern matching mungkin lebih readable untuk operasi kecil.

Decision rule:

```text
Jika operasi kecil, lokal, dan tidak butuh polymorphic extension object,
gunakan sealed + switch.

Jika operasi besar, reusable, punya dependency/context, atau ingin dijadikan object,
Visitor masih berguna.
```

---

## 16. Pattern Matching Switch sebagai Visitor Ringan

Pattern matching switch bisa dianggap sebagai “visitor tanpa ceremony” untuk hierarchy tertutup.

Contoh:

```java
public final class DecisionAuditMapper {

    public AuditMessage map(CaseDecision decision) {
        return switch (decision) {
            case ApprovalDecision approval -> approvalAudit(approval);
            case RejectionDecision rejection -> rejectionAudit(rejection);
            case RequestForInfoDecision rfi -> rfiAudit(rfi);
            case EscalationDecision escalation -> escalationAudit(escalation);
            case WithdrawalDecision withdrawal -> withdrawalAudit(withdrawal);
        };
    }

    private AuditMessage approvalAudit(ApprovalDecision decision) {
        return new AuditMessage(
                decision.caseId(),
                "CASE_APPROVED",
                "Case approved by " + decision.approvedBy(),
                decision.approvedAt()
        );
    }

    private AuditMessage rejectionAudit(RejectionDecision decision) {
        return new AuditMessage(
                decision.caseId(),
                "CASE_REJECTED",
                "Case rejected: " + decision.reason(),
                decision.rejectedAt()
        );
    }

    private AuditMessage rfiAudit(RequestForInfoDecision decision) {
        return new AuditMessage(
                decision.caseId(),
                "REQUEST_FOR_INFO",
                "Information requested before " + decision.dueDate(),
                decision.requestedAt()
        );
    }

    private AuditMessage escalationAudit(EscalationDecision decision) {
        return new AuditMessage(
                decision.caseId(),
                "CASE_ESCALATED",
                "Case escalated to " + decision.escalationLevel(),
                decision.escalatedAt()
        );
    }

    private AuditMessage withdrawalAudit(WithdrawalDecision decision) {
        return new AuditMessage(
                decision.caseId(),
                "CASE_WITHDRAWN",
                "Case withdrawn by " + decision.withdrawnBy(),
                decision.withdrawnAt()
        );
    }
}
```

Ini sering lebih pragmatic daripada Visitor penuh.

---

## 17. Decision Matrix: Visitor vs Switch vs Polymorphism

| Situation | Better Choice | Reason |
|---|---|---|
| Behavior adalah core responsibility object | Polymorphism | Dekatkan behavior ke data |
| Operasi eksternal banyak, subtype stabil | Visitor | Operasi baru mudah ditambah |
| Subtype sering bertambah, operasi stabil | Polymorphism | Subtype baru membawa behavior sendiri |
| Hierarchy sealed, operasi kecil/lokal | Pattern matching switch | Lebih sederhana daripada Visitor |
| Hierarchy sealed, operasi besar/reusable | Visitor atau mapper class with switch | Visitor jika butuh object operation |
| Butuh runtime algorithm selection by config | Strategy | Variasi bukan berdasarkan subtype semata |
| Butuh boolean business rule composition | Specification | Rule composability lebih penting |
| Butuh state-dependent behavior | State Pattern | State transition lebih penting daripada operasi lintas tipe |
| Butuh interpret expression tree | Visitor atau sealed switch | Tergantung ukuran operasi |

---

## 18. Advanced Visitor Variants

### 18.1 Generic Return Visitor

```java
public interface Visitor<R> {
    R visitApproval(ApprovalDecision decision);
    R visitRejection(RejectionDecision decision);
}
```

Baik untuk pure transformation.

### 18.2 Visitor dengan Checked Exception

Kadang visitor melakukan operasi yang bisa gagal.

```java
public interface ThrowingDecisionVisitor<R, E extends Exception> {
    R visitApproval(ApprovalDecision decision) throws E;
    R visitRejection(RejectionDecision decision) throws E;
    R visitRequestForInfo(RequestForInfoDecision decision) throws E;
    R visitEscalation(EscalationDecision decision) throws E;
    R visitWithdrawal(WithdrawalDecision decision) throws E;
}
```

Namun ini membuat API lebih kompleks. Gunakan jika failure memang bagian kontrak.

### 18.3 Visitor dengan Accumulator

Untuk traversal tree:

```java
public interface RuleNodeVisitor<R> {
    R visitAnd(AndNode node);
    R visitOr(OrNode node);
    R visitNot(NotNode node);
    R visitCondition(ConditionNode node);
}
```

Visitor bisa menghitung hasil recursive:

```java
public final class RuleComplexityVisitor implements RuleNodeVisitor<Integer> {

    @Override
    public Integer visitAnd(AndNode node) {
        return 1 + node.children().stream()
                .map(child -> child.accept(this))
                .reduce(0, Integer::sum);
    }

    @Override
    public Integer visitOr(OrNode node) {
        return 1 + node.children().stream()
                .map(child -> child.accept(this))
                .reduce(0, Integer::sum);
    }

    @Override
    public Integer visitNot(NotNode node) {
        return 1 + node.child().accept(this);
    }

    @Override
    public Integer visitCondition(ConditionNode node) {
        return 1;
    }
}
```

---

## 19. Visitor untuk Tree / AST / Rule Expression

Visitor sangat kuat untuk struktur tree.

Contoh regulatory rule expression:

```java
public sealed interface RuleExpression permits
        AndExpression,
        OrExpression,
        NotExpression,
        ConditionExpression {

    <R> R accept(RuleExpressionVisitor<R> visitor);
}
```

```java
public record AndExpression(List<RuleExpression> children) implements RuleExpression {
    public AndExpression {
        children = List.copyOf(children);
        if (children.isEmpty()) {
            throw new IllegalArgumentException("AND expression requires at least one child");
        }
    }

    @Override
    public <R> R accept(RuleExpressionVisitor<R> visitor) {
        return visitor.visitAnd(this);
    }
}

public record OrExpression(List<RuleExpression> children) implements RuleExpression {
    public OrExpression {
        children = List.copyOf(children);
        if (children.isEmpty()) {
            throw new IllegalArgumentException("OR expression requires at least one child");
        }
    }

    @Override
    public <R> R accept(RuleExpressionVisitor<R> visitor) {
        return visitor.visitOr(this);
    }
}

public record NotExpression(RuleExpression child) implements RuleExpression {
    public NotExpression {
        Objects.requireNonNull(child);
    }

    @Override
    public <R> R accept(RuleExpressionVisitor<R> visitor) {
        return visitor.visitNot(this);
    }
}

public record ConditionExpression(String field, String operator, String expectedValue) implements RuleExpression {
    public ConditionExpression {
        Objects.requireNonNull(field);
        Objects.requireNonNull(operator);
        Objects.requireNonNull(expectedValue);
    }

    @Override
    public <R> R accept(RuleExpressionVisitor<R> visitor) {
        return visitor.visitCondition(this);
    }
}
```

Visitor:

```java
public interface RuleExpressionVisitor<R> {
    R visitAnd(AndExpression expression);
    R visitOr(OrExpression expression);
    R visitNot(NotExpression expression);
    R visitCondition(ConditionExpression expression);
}
```

Evaluator:

```java
public final class RuleEvaluationVisitor implements RuleExpressionVisitor<Boolean> {

    private final RuleEvaluationContext context;

    public RuleEvaluationVisitor(RuleEvaluationContext context) {
        this.context = Objects.requireNonNull(context);
    }

    @Override
    public Boolean visitAnd(AndExpression expression) {
        for (RuleExpression child : expression.children()) {
            if (!child.accept(this)) {
                return false;
            }
        }
        return true;
    }

    @Override
    public Boolean visitOr(OrExpression expression) {
        for (RuleExpression child : expression.children()) {
            if (child.accept(this)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public Boolean visitNot(NotExpression expression) {
        return !expression.child().accept(this);
    }

    @Override
    public Boolean visitCondition(ConditionExpression expression) {
        String actual = context.valueOf(expression.field());
        return switch (expression.operator()) {
            case "EQ" -> Objects.equals(actual, expression.expectedValue());
            case "NE" -> !Objects.equals(actual, expression.expectedValue());
            default -> throw new IllegalArgumentException("Unsupported operator: " + expression.operator());
        };
    }
}
```

This is a natural Visitor use case.

Kenapa?

Karena expression tree stabil:

```text
AND
OR
NOT
CONDITION
```

Tetapi operasi bisa banyak:

```text
evaluate
render as text
render as SQL
validate
calculate complexity
extract fields
serialize
explain decision
```

---

## 20. Pattern Matching Alternative untuk Rule Expression

Dengan sealed switch:

```java
public final class RuleEvaluator {

    private final RuleEvaluationContext context;

    public RuleEvaluator(RuleEvaluationContext context) {
        this.context = Objects.requireNonNull(context);
    }

    public boolean evaluate(RuleExpression expression) {
        return switch (expression) {
            case AndExpression and -> and.children().stream().allMatch(this::evaluate);
            case OrExpression or -> or.children().stream().anyMatch(this::evaluate);
            case NotExpression not -> !evaluate(not.child());
            case ConditionExpression condition -> evaluateCondition(condition);
        };
    }

    private boolean evaluateCondition(ConditionExpression expression) {
        String actual = context.valueOf(expression.field());
        return switch (expression.operator()) {
            case "EQ" -> Objects.equals(actual, expression.expectedValue());
            case "NE" -> !Objects.equals(actual, expression.expectedValue());
            default -> throw new IllegalArgumentException("Unsupported operator: " + expression.operator());
        };
    }
}
```

Ini lebih pendek dan sering lebih readable.

Tetapi jika ada 15 operasi berbeda terhadap `RuleExpression`, Visitor bisa memberi struktur yang lebih seragam.

---

## 21. Encapsulation Problem

Visitor sering dikritik karena bisa memaksa subtype membuka detail internal.

Contoh buruk:

```java
public record RejectionDecision(
        String caseId,
        String internalOfficerNote,
        String applicantVisibleReason,
        String rawWorkflowPayload,
        Map<String, Object> internalMetadata
) implements CaseDecision {
    ...
}
```

Jika visitor butuh semua field, domain object mungkin berubah menjadi data bag.

Pertanyaan review:

```text
Apakah visitor membaca data yang memang bagian public semantic object?
Atau visitor membongkar internal implementation detail?
```

Jika visitor perlu private detail untuk operasi yang sangat domain-specific, mungkin behavior itu seharusnya tetap di domain object.

Contoh:

```java
public record RejectionDecision(...) implements CaseDecision {

    public boolean isAppealableOn(Instant now) {
        return rejectedAt.plus(Duration.ofDays(30)).isAfter(now)
                && appealNotExplicitlyWaived;
    }
}
```

`isAppealableOn` mungkin lebih pantas berada di domain object daripada visitor karena ia invariant domain.

---

## 22. Broken Encapsulation Visitor

Anti-pattern:

```text
Visitor dipakai supaya semua logic ada di luar object,
sehingga object hanya record/data container,
dan semua behavior tersebar di visitor/service.
```

Gejala:

1. Domain object hanya getter.
2. Visitor memeriksa banyak field internal.
3. Visitor melakukan validasi invariant yang seharusnya dijaga object.
4. Banyak visitor menduplikasi rule kecil.
5. Perubahan field internal merusak banyak visitor.

Visitor sehat tidak berarti domain object bodoh.

Visitor sehat berarti:

```text
Domain object menjaga invariant-nya sendiri.
Visitor menjalankan operasi eksternal yang sah terhadap semantic public surface object.
```

---

## 23. Visitor Boilerplate Hell

Gejala:

1. Setiap subtype punya method `accept` identik.
2. Visitor interface punya puluhan method.
3. Menambah subtype memaksa update puluhan visitor.
4. Banyak visitor hanya peduli 2 dari 20 subtype.
5. Default implementation mengembalikan null.
6. Ada `UnsupportedOperationException` di banyak method.

Contoh smell:

```java
@Override
public String visitEscalation(EscalationDecision decision) {
    return null;
}
```

Atau:

```java
@Override
public ReportRow visitWithdrawal(WithdrawalDecision decision) {
    throw new UnsupportedOperationException("Withdrawal not supported");
}
```

Jika visitor sering tidak exhaustive secara bermakna, hierarchy mungkin terlalu luas untuk satu visitor interface.

Solusi:

1. Split hierarchy.
2. Split visitor by capability.
3. Gunakan sealed switch lokal.
4. Gunakan polymorphism untuk operasi inti.
5. Gunakan default visitor dengan explicit fallback.
6. Jangan pakai Visitor jika operasi hanya berlaku untuk subset kecil.

---

## 24. Default Visitor: Berguna tapi Berbahaya

Kadang kita membuat base visitor:

```java
public abstract class DefaultCaseDecisionVisitor<R> implements CaseDecisionVisitor<R> {

    protected R defaultVisit(CaseDecision decision) {
        throw new UnsupportedOperationException(
                "Unsupported decision type: " + decision.getClass().getName()
        );
    }

    @Override
    public R visitApproval(ApprovalDecision decision) {
        return defaultVisit(decision);
    }

    @Override
    public R visitRejection(RejectionDecision decision) {
        return defaultVisit(decision);
    }

    @Override
    public R visitRequestForInfo(RequestForInfoDecision decision) {
        return defaultVisit(decision);
    }

    @Override
    public R visitEscalation(EscalationDecision decision) {
        return defaultVisit(decision);
    }

    @Override
    public R visitWithdrawal(WithdrawalDecision decision) {
        return defaultVisit(decision);
    }
}
```

Lalu subclass override hanya yang dibutuhkan.

Kelebihan:

1. Mengurangi boilerplate.
2. Cocok untuk visitor subset.

Kekurangan:

1. Mengurangi compile-time completeness.
2. Error pindah ke runtime.
3. Bisa menyembunyikan subtype baru yang belum ditangani.

Gunakan hanya jika operasi memang valid untuk subset dan fallback-nya eksplisit.

---

## 25. Acyclic Visitor

Acyclic Visitor mencoba menghindari coupling besar visitor interface.

Alih-alih satu visitor tahu semua subtype, subtype memeriksa apakah visitor mendukung tipe tertentu.

Contoh sederhana:

```java
public interface DecisionVisitorMarker {}

public interface ApprovalDecisionVisitor<R> extends DecisionVisitorMarker {
    R visitApproval(ApprovalDecision decision);
}

public interface RejectionDecisionVisitor<R> extends DecisionVisitorMarker {
    R visitRejection(RejectionDecision decision);
}
```

Element:

```java
public record ApprovalDecision(...) implements CaseDecision {

    @Override
    @SuppressWarnings("unchecked")
    public <R> R accept(DecisionVisitorMarker visitor) {
        if (visitor instanceof ApprovalDecisionVisitor<?> approvalVisitor) {
            return ((ApprovalDecisionVisitor<R>) approvalVisitor).visitApproval(this);
        }
        throw new UnsupportedOperationException("Visitor does not support ApprovalDecision");
    }
}
```

Ini jarang worth it di application code biasa karena kompleksitasnya tinggi.

Gunakan hanya jika:

1. Plugin system butuh partial visitor.
2. Hierarchy besar dan visitor tidak selalu exhaustive.
3. Runtime extensibility lebih penting daripada simplicity.

Untuk kebanyakan Java enterprise application, sealed switch atau split visitor lebih baik.

---

## 26. Visitor dan Generics

Visitor dengan generics bisa kuat, tetapi mudah berlebihan.

Contoh yang masih masuk akal:

```java
public interface NodeVisitor<R> {
    R visitText(TextNode node);
    R visitImage(ImageNode node);
    R visitTable(TableNode node);
}
```

Contoh yang mulai mencurigakan:

```java
public interface NodeVisitor<C, R, E extends Exception, M extends Metadata> {
    R visitText(TextNode<C, M> node, C context) throws E;
    R visitImage(ImageNode<C, M> node, C context) throws E;
    R visitTable(TableNode<C, M> node, C context) throws E;
}
```

Jika visitor generic signature sulit dibaca, kemungkinan desainnya terlalu abstrak.

Rule:

```text
Generic boleh dipakai untuk return type dan exception type.
Jangan membuat visitor menjadi type algebra yang lebih sulit dari domain problem-nya.
```

---

## 27. Visitor dan Dependency Injection

Visitor sering membutuhkan dependencies:

```text
template engine
clock
localization service
configuration
formatter
policy registry
```

Dua pendekatan:

### 27.1 Visitor Stateless Singleton Bean

```java
@Component
public final class AuditMessageVisitor implements CaseDecisionVisitor<AuditMessage> {
    private final Clock clock;

    public AuditMessageVisitor(Clock clock) {
        this.clock = clock;
    }

    ...
}
```

Usage:

```java
AuditMessage audit = decision.accept(auditMessageVisitor);
```

Baik jika visitor tidak punya per-call context mutable.

### 27.2 Visitor Factory untuk Per-Request Context

```java
@Component
public final class EmailBodyVisitorFactory {

    private final TemplateRenderer renderer;

    public EmailBodyVisitorFactory(TemplateRenderer renderer) {
        this.renderer = renderer;
    }

    public EmailBodyVisitor create(EmailRenderContext context) {
        return new EmailBodyVisitor(renderer, context);
    }
}
```

Usage:

```java
EmailBodyVisitor visitor = visitorFactory.create(context);
String body = decision.accept(visitor);
```

Ini lebih aman daripada menyimpan context mutable di singleton visitor.

Anti-pattern:

```java
@Component
public final class EmailBodyVisitor implements CaseDecisionVisitor<String> {
    private EmailRenderContext context; // bad mutable per-call state in singleton
}
```

Jangan simpan per-request state di singleton bean.

---

## 28. Visitor dan Thread Safety

Visitor bisa thread-safe jika:

1. Immutable.
2. Stateless.
3. Dependencies thread-safe.
4. Context per request immutable.
5. Tidak menyimpan accumulator mutable global.

Visitor tidak thread-safe jika:

1. Menyimpan mutable result list internal.
2. Dipakai sebagai singleton tetapi ada per-call state.
3. Menggunakan `StringBuilder` field bersama.
4. Menggunakan cache tanpa concurrency control.

Buruk:

```java
public final class ReportVisitor implements CaseDecisionVisitor<Void> {
    private final List<ReportRow> rows = new ArrayList<>();

    @Override
    public Void visitApproval(ApprovalDecision decision) {
        rows.add(...);
        return null;
    }
}
```

Lebih baik:

```java
public final class ReportRowVisitor implements CaseDecisionVisitor<ReportRow> {
    @Override
    public ReportRow visitApproval(ApprovalDecision decision) {
        return ...;
    }
}
```

Accumulator eksternal dikelola oleh caller:

```java
List<ReportRow> rows = decisions.stream()
        .map(decision -> decision.accept(reportRowVisitor))
        .toList();
```

---

## 29. Visitor dan Error Handling

Jangan return `null` untuk tipe yang belum didukung.

Buruk:

```java
@Override
public AuditMessage visitWithdrawal(WithdrawalDecision decision) {
    return null;
}
```

Lebih baik eksplisit:

```java
@Override
public AuditMessage visitWithdrawal(WithdrawalDecision decision) {
    throw new UnsupportedDecisionForAuditException(decision.caseId(), "WITHDRAWAL");
}
```

Atau gunakan result type:

```java
public sealed interface MappingResult<T> permits MappingResult.Mapped, MappingResult.Skipped {

    record Mapped<T>(T value) implements MappingResult<T> {}

    record Skipped<T>(String reason) implements MappingResult<T> {}
}
```

Visitor:

```java
public final class OptionalNotificationVisitor
        implements CaseDecisionVisitor<MappingResult<NotificationRequest>> {

    @Override
    public MappingResult<NotificationRequest> visitApproval(ApprovalDecision decision) {
        return new MappingResult.Mapped<>(...);
    }

    @Override
    public MappingResult<NotificationRequest> visitWithdrawal(WithdrawalDecision decision) {
        return new MappingResult.Skipped<>("Withdrawal does not notify applicant");
    }
}
```

Ini lebih jelas daripada `Optional.empty()` jika alasan skip penting untuk audit/debugging.

---

## 30. Visitor dan Observability

Visitor sering dipakai untuk operasi mapping/rendering/evaluation. Jangan membuat observability terlalu noisy, tetapi pastikan failure bisa dilacak.

Catat metadata seperti:

```text
visitor name
decision type
case id
operation name
outcome
unsupported type
rule id
render template version
mapping version
```

Contoh:

```java
public final class ObservedDecisionVisitor<R> implements CaseDecisionVisitor<R> {

    private final String operationName;
    private final CaseDecisionVisitor<R> delegate;
    private final DecisionMetrics metrics;

    public ObservedDecisionVisitor(
            String operationName,
            CaseDecisionVisitor<R> delegate,
            DecisionMetrics metrics
    ) {
        this.operationName = Objects.requireNonNull(operationName);
        this.delegate = Objects.requireNonNull(delegate);
        this.metrics = Objects.requireNonNull(metrics);
    }

    @Override
    public R visitApproval(ApprovalDecision decision) {
        return observe("ApprovalDecision", () -> delegate.visitApproval(decision));
    }

    @Override
    public R visitRejection(RejectionDecision decision) {
        return observe("RejectionDecision", () -> delegate.visitRejection(decision));
    }

    @Override
    public R visitRequestForInfo(RequestForInfoDecision decision) {
        return observe("RequestForInfoDecision", () -> delegate.visitRequestForInfo(decision));
    }

    @Override
    public R visitEscalation(EscalationDecision decision) {
        return observe("EscalationDecision", () -> delegate.visitEscalation(decision));
    }

    @Override
    public R visitWithdrawal(WithdrawalDecision decision) {
        return observe("WithdrawalDecision", () -> delegate.visitWithdrawal(decision));
    }

    private R observe(String decisionType, Supplier<R> action) {
        long started = System.nanoTime();
        try {
            R result = action.get();
            metrics.recordSuccess(operationName, decisionType, System.nanoTime() - started);
            return result;
        } catch (RuntimeException ex) {
            metrics.recordFailure(operationName, decisionType, ex.getClass().getSimpleName());
            throw ex;
        }
    }
}
```

Ini sendiri adalah kombinasi Visitor + Decorator.

---

## 31. Visitor dan Testing Strategy

### 31.1 Test Exhaustiveness by Construction

Untuk setiap concrete visitor, test semua subtype.

```java
class AuditMessageVisitorTest {

    private final AuditMessageVisitor visitor = new AuditMessageVisitor();

    @Test
    void mapsApprovalDecision() {
        ApprovalDecision decision = new ApprovalDecision("CASE-1", "officer-a", Instant.parse("2026-01-01T00:00:00Z"));

        AuditMessage audit = decision.accept(visitor);

        assertEquals("CASE_APPROVED", audit.eventType());
    }

    @Test
    void mapsRejectionDecision() {
        RejectionDecision decision = new RejectionDecision("CASE-1", "Missing evidence", Instant.parse("2026-01-01T00:00:00Z"));

        AuditMessage audit = decision.accept(visitor);

        assertEquals("CASE_REJECTED", audit.eventType());
    }
}
```

### 31.2 Golden Master untuk Renderer

Jika visitor menghasilkan text/report/email, gunakan golden master snapshot secara hati-hati.

```text
Input decision fixture
Expected rendered output
Diff jika berubah
```

### 31.3 Contract Test untuk Visitor Interface

Buat fixture list semua decision type:

```java
static List<CaseDecision> allDecisionTypes() {
    return List.of(
            new ApprovalDecision(...),
            new RejectionDecision(...),
            new RequestForInfoDecision(...),
            new EscalationDecision(...),
            new WithdrawalDecision(...)
    );
}
```

Test visitor tidak throw kecuali memang expected:

```java
@ParameterizedTest
@MethodSource("allDecisionTypes")
void auditVisitorSupportsAllDecisionTypes(CaseDecision decision) {
    assertDoesNotThrow(() -> decision.accept(new AuditMessageVisitor()));
}
```

### 31.4 Mutation Testing Angle

Visitor sering punya branch per subtype. Mutation testing berguna untuk memastikan setiap branch diuji.

Hal yang ingin ditangkap:

1. Wrong event type.
2. Wrong field mapping.
3. Missing branch.
4. Reversed boolean.
5. Wrong date/time field.
6. Unsupported subtype.

---

## 32. Refactoring Path: Dari `instanceof` Tersebar ke Visitor

### Step 1 — Temukan Branching yang Sama

Cari pola:

```java
if (x instanceof A) ...
else if (x instanceof B) ...
else if (x instanceof C) ...
```

Jika pola yang sama muncul di banyak tempat untuk hierarchy yang sama, kandidat Visitor atau sealed switch.

### Step 2 — Pastikan Hierarchy-nya Bermakna

Jangan buat Visitor di atas tipe yang tidak punya konsep domain jelas.

Buruk:

```text
Object visitor over everything
```

Baik:

```text
CaseDecisionVisitor
RuleExpressionVisitor
DocumentNodeVisitor
WorkflowStateVisitor
```

### Step 3 — Buat Root Interface

```java
public sealed interface CaseDecision permits ... {
    <R> R accept(CaseDecisionVisitor<R> visitor);
}
```

### Step 4 — Buat Visitor Interface

```java
public interface CaseDecisionVisitor<R> {
    R visitApproval(ApprovalDecision decision);
    R visitRejection(RejectionDecision decision);
    ...
}
```

### Step 5 — Implement `accept` di Subtype

```java
@Override
public <R> R accept(CaseDecisionVisitor<R> visitor) {
    return visitor.visitApproval(this);
}
```

### Step 6 — Pindahkan Satu Operasi Dulu

Jangan refactor semua sekaligus.

Mulai dari operasi yang paling jelas:

```text
Audit mapping
atau
Timeline rendering
```

### Step 7 — Tambahkan Test Sebelum Menghapus Branch Lama

Gunakan characterization test untuk memastikan output sama.

### Step 8 — Hapus Branch Lama

Setelah visitor stabil, hapus `if instanceof` lama.

### Step 9 — Evaluasi Apakah Visitor Benar-benar Membantu

Jika hasilnya lebih rumit, mundur ke sealed switch.

---

## 33. Refactoring Path: Dari Visitor ke Pattern Matching Switch

Kadang Visitor yang dibuat dulu menjadi terlalu berat.

Gejala:

1. Hanya ada satu atau dua visitor.
2. Operasi kecil.
3. Banyak boilerplate `accept`.
4. Hierarchy sealed.
5. Developer lebih mudah membaca switch daripada visitor traversal.

Refactoring:

### Step 1 — Jadikan Hierarchy Sealed

```java
public sealed interface CaseDecision permits ApprovalDecision, RejectionDecision {}
```

### Step 2 — Buat Mapper dengan Switch

```java
public AuditMessage map(CaseDecision decision) {
    return switch (decision) {
        case ApprovalDecision approval -> ...;
        case RejectionDecision rejection -> ...;
    };
}
```

### Step 3 — Pindahkan Logic dari Visitor ke Private Methods

```java
private AuditMessage mapApproval(ApprovalDecision decision) { ... }
```

### Step 4 — Hapus `accept` jika Tidak Ada Visitor Lain

Jangan mempertahankan ceremony tanpa kebutuhan.

---

## 34. Anti-Pattern Catalog

### 34.1 Instanceof Everywhere

Gejala:

```text
Banyak service melakukan branching terhadap hierarchy yang sama.
```

Dampak:

1. Subtype baru mudah terlupakan.
2. Behavior tersebar.
3. Bug muncul sebagai missing branch.
4. Review sulit.

Solusi:

1. Polymorphism.
2. Visitor.
3. Sealed switch.
4. Strategy registry jika variasi berdasarkan config.

---

### 34.2 Visitor for Everything

Gejala:

```text
Semua behavior dipindah ke visitor.
Object kehilangan responsibility.
```

Dampak:

1. Anemic domain model.
2. Encapsulation rusak.
3. Banyak visitor kecil.
4. Logic sulit ditemukan.

Solusi:

1. Kembalikan invariant ke domain object.
2. Pakai visitor hanya untuk operasi eksternal.
3. Bedakan core behavior vs projection/rendering/mapping.

---

### 34.3 Visitor Interface Terlalu Besar

Gejala:

```text
Visitor punya 30+ visit methods.
```

Dampak:

1. Menambah subtype sangat mahal.
2. Banyak method kosong.
3. Cognitive load tinggi.

Solusi:

1. Split hierarchy.
2. Split visitor per bounded context.
3. Gunakan sealed switch untuk operasi lokal.

---

### 34.4 Default Method Hiding Missing Case

Buruk:

```java
public interface CaseDecisionVisitor<R> {
    default R visitApproval(ApprovalDecision decision) { return null; }
    default R visitRejection(RejectionDecision decision) { return null; }
}
```

Dampak:

1. Compile-time safety hilang.
2. Missing branch jadi runtime bug.
3. Null merembes.

Solusi:

```java
public interface CaseDecisionVisitor<R> {
    R visitApproval(ApprovalDecision decision);
    R visitRejection(RejectionDecision decision);
}
```

Atau default harus fail-fast:

```java
throw new UnsupportedOperationException(...);
```

---

### 34.5 Visitor Doing I/O Side Effects

Visitor yang seharusnya transformasi malah mengirim email, update database, publish event.

Buruk:

```java
public final class NotificationSendingVisitor implements CaseDecisionVisitor<Void> {
    public Void visitApproval(ApprovalDecision decision) {
        emailClient.send(...);
        auditRepository.save(...);
        eventPublisher.publish(...);
        return null;
    }
}
```

Dampak:

1. Ordering side effect sulit dipahami.
2. Retry/idempotency kabur.
3. Test berat.
4. Transaction boundary tidak jelas.

Solusi:

Visitor menghasilkan intent/request:

```java
NotificationRequest request = decision.accept(notificationRequestVisitor);
notificationService.send(request);
```

---

### 34.6 Pattern Matching God Switch

Sealed switch bisa menjadi anti-pattern jika satu method terlalu besar.

Buruk:

```java
switch (decision) {
    case ApprovalDecision approval -> {
        validate(...);
        save(...);
        sendEmail(...);
        publishEvent(...);
        renderAudit(...);
        calculateSla(...);
    }
    ...
}
```

Solusi:

1. Switch hanya dispatch.
2. Logic pindah ke private method/class.
3. Side effect dipisah dari mapping.
4. Gunakan command handler/workflow service untuk use case orchestration.

---

## 35. Java 8–25 Perspective

### Java 8

Relevant features:

1. Lambda.
2. Functional interface.
3. Default method.
4. Stream.
5. Optional.

Impact:

- Strategy menjadi lebih ringan.
- Visitor tetap verbose.
- Banyak operasi kecil lebih baik memakai function/lambda daripada visitor.

Contoh:

```java
Map<Class<? extends CaseDecision>, Function<CaseDecision, String>> renderers;
```

Namun class-keyed map kehilangan type safety dan mudah menjadi registry rapuh.

---

### Java 11

Impact lebih ke library/runtime stability. Pattern decision tidak banyak berubah, tetapi `var` dari Java 10 bisa memengaruhi readability jika visitor generic terlalu rumit.

Buruk:

```java
var result = decision.accept(visitor);
```

Jika return type tidak jelas, explicit type lebih baik.

---

### Java 16–17

Records dan sealed classes membuat domain alternatives lebih ekspresif.

```java
public sealed interface CaseDecision permits ApprovalDecision, RejectionDecision {}
public record ApprovalDecision(...) implements CaseDecision {}
```

Impact besar:

1. DTO/value-like domain alternatives lebih ringkas.
2. Sealed hierarchy membuat exhaustive reasoning mungkin.
3. Visitor tidak lagi satu-satunya cara type-safe untuk closed hierarchy.

---

### Java 21

Pattern matching switch menjadi practical mainstream.

Impact:

1. Banyak Visitor kecil bisa diganti switch expression.
2. Dispatch logic lebih lokal.
3. Exhaustiveness lebih jelas pada sealed hierarchy.
4. Null handling dalam switch perlu diperhatikan.

---

### Java 25

Java 25 melanjutkan arah modern Java: language/runtime makin mendukung explicit modeling dan concurrency modern.

Untuk topik Visitor, efek terbesarnya tetap:

1. Sealed hierarchy.
2. Pattern matching.
3. Records.
4. Switch expression.

Artinya, di Java modern, Visitor bukan default pertama untuk semua closed hierarchy.

Default reasoning yang lebih baik:

```text
Mulai dari sealed hierarchy + switch untuk operasi kecil.
Naik ke Visitor jika operasi banyak, reusable, dan butuh object-level operation abstraction.
Turun ke polymorphism jika behavior adalah invariant/core responsibility subtype.
```

---

## 36. Case Study: Regulatory Decision Output

### 36.1 Problem

Sistem memiliki decision types:

```text
APPROVED
REJECTED
REQUEST_FOR_INFO
ESCALATED
WITHDRAWN
```

Output yang dibutuhkan:

```text
audit event
UI timeline item
email notification
SLA impact
report row
API response
```

### 36.2 Bad Initial Design

```java
public final class DecisionService {

    public void handle(CaseDecision decision) {
        if (decision instanceof ApprovalDecision approval) {
            audit("approved");
            email("approved");
            updateSla("closed");
            renderTimeline("approved");
        } else if (decision instanceof RejectionDecision rejection) {
            audit("rejected");
            email("rejected");
            updateSla("closed");
            renderTimeline("rejected");
        }
    }
}
```

Masalah:

1. Dispatch, business action, audit, email, SLA, rendering bercampur.
2. Sulit test per concern.
3. Sulit menambah output baru.
4. Sulit audit perubahan logic.

### 36.3 Improved Design

Domain decision:

```java
public sealed interface CaseDecision permits
        ApprovalDecision,
        RejectionDecision,
        RequestForInfoDecision,
        EscalationDecision,
        WithdrawalDecision {

    String caseId();
}
```

Use switch-based mapper untuk operasi kecil:

```java
public final class SlaImpactMapper {

    public SlaImpact map(CaseDecision decision) {
        return switch (decision) {
            case ApprovalDecision ignored -> SlaImpact.closed("Approved");
            case RejectionDecision ignored -> SlaImpact.closed("Rejected");
            case RequestForInfoDecision rfi -> SlaImpact.pausedUntil(rfi.dueDate(), "Awaiting applicant input");
            case EscalationDecision ignored -> SlaImpact.extended(Duration.ofDays(2), "Escalated review");
            case WithdrawalDecision ignored -> SlaImpact.closed("Withdrawn");
        };
    }
}
```

Visitor untuk operasi besar/reusable:

```java
public final class DecisionEmailModelVisitor implements CaseDecisionVisitor<EmailModel> {
    ...
}
```

Command handler orchestrates:

```java
public final class FinalizeDecisionHandler {

    private final SlaImpactMapper slaImpactMapper;
    private final DecisionAuditMapper auditMapper;
    private final DecisionEmailModelVisitor emailModelVisitor;
    private final Outbox outbox;

    public void handle(FinalizeDecisionCommand command) {
        CaseDecision decision = command.decision();

        SlaImpact impact = slaImpactMapper.map(decision);
        AuditMessage audit = auditMapper.map(decision);
        EmailModel email = decision.accept(emailModelVisitor);

        // transaction boundary decision omitted for brevity
        outbox.add(audit.toEvent());
        outbox.add(email.toNotificationEvent());
    }
}
```

Key principle:

```text
Visitor/switch map decision to outputs.
Handler orchestrates use case.
Neither visitor nor mapper should secretly perform irreversible side effects.
```

---

## 37. Security and Audit Considerations

Visitor used for rendering/exporting can accidentally leak sensitive information.

Example risk:

```java
public String visitRejection(RejectionDecision decision) {
    return decision.internalOfficerNote();
}
```

If this visitor is used for applicant email, that is a data leak.

Mitigation:

1. Separate visitor by audience.
2. Use explicit output model names.
3. Avoid generic `DecisionRenderer` if audience differs.
4. Include classification in fields.
5. Add tests for sensitive field exclusion.

Better names:

```text
ApplicantEmailDecisionVisitor
OfficerTimelineDecisionVisitor
InternalAuditDecisionVisitor
PublicApiDecisionMapper
```

Bad names:

```text
DecisionRenderer
DecisionMapper
DecisionFormatter
```

Generic names hide security semantics.

---

## 38. Performance Considerations

Visitor overhead is usually negligible compared to I/O, database, HTTP, serialization, or template rendering.

But be careful in hot paths:

1. Avoid creating new visitor per item if visitor is stateless.
2. Avoid reflection-based visitor dispatch.
3. Avoid class-keyed maps with unchecked casts in tight loops.
4. Avoid recursive visitor without depth protection for untrusted trees.
5. Avoid excessive allocation in tree traversal.

For large trees:

```text
recursive Visitor can StackOverflowError
```

Mitigation:

1. Limit depth.
2. Validate tree at construction.
3. Use iterative traversal for untrusted/deep structures.
4. Track visited nodes if graph may contain cycles.

---

## 39. Design Review Checklist

Gunakan checklist ini saat melihat Visitor atau branching hierarchy.

### 39.1 Fit Check

```text
[ ] Apakah hierarchy relatif stabil?
[ ] Apakah operasi sering bertambah?
[ ] Apakah operasi bukan core responsibility subtype?
[ ] Apakah operasi perlu dikumpulkan lintas subtype?
[ ] Apakah sealed + switch lebih sederhana?
[ ] Apakah polymorphism biasa lebih natural?
```

### 39.2 Encapsulation Check

```text
[ ] Apakah visitor hanya memakai public semantic data?
[ ] Apakah visitor tidak membongkar internal state?
[ ] Apakah invariant tetap dijaga domain object?
[ ] Apakah visitor tidak mengubah state object diam-diam?
```

### 39.3 Completeness Check

```text
[ ] Apakah semua subtype ditangani?
[ ] Apakah subtype baru memicu compile error di operasi penting?
[ ] Apakah default visitor tidak menyembunyikan missing case?
[ ] Apakah unsupported case fail-fast dengan pesan jelas?
```

### 39.4 Side Effect Check

```text
[ ] Apakah visitor pure transformation jika memungkinkan?
[ ] Apakah I/O tidak dilakukan diam-diam di visitor?
[ ] Apakah transaction boundary jelas?
[ ] Apakah retry/idempotency tidak disembunyikan di visitor?
```

### 39.5 Testability Check

```text
[ ] Apakah setiap subtype punya test?
[ ] Apakah visitor output punya expected fixture?
[ ] Apakah sensitive data leak diuji?
[ ] Apakah unsupported subtype behavior diuji?
```

---

## 40. Common Staff-Level Discussion

### Question 1

> Kenapa tidak taruh semua behavior di domain object?

Jawaban:

Karena tidak semua operasi adalah responsibility domain object. Domain object harus menjaga invariant dan behavior inti. Tetapi operasi seperti rendering email, mapping API response, exporting report, atau formatting audit message sering milik boundary/application concern. Jika dimasukkan ke domain, domain akan bergantung pada concern teknis dan menjadi fat model.

---

### Question 2

> Kenapa tidak pakai `instanceof` saja?

Jawaban:

Untuk satu operasi kecil, terutama dengan sealed hierarchy, pattern matching switch bisa sangat baik. Masalah muncul ketika branching terhadap hierarchy yang sama tersebar di banyak tempat. Saat subtype baru muncul, risiko missing branch naik. Visitor atau mapper terstruktur membantu mengumpulkan operasi dan membuat completeness lebih terlihat.

---

### Question 3

> Apakah Visitor masih relevan setelah sealed class dan pattern matching?

Jawaban:

Masih, tetapi bukan default pertama untuk semua kasus. Pattern matching switch sering lebih sederhana untuk operasi kecil/lokal. Visitor tetap berguna untuk operasi besar, reusable, punya context/dependency, atau saat kamu ingin operation object yang bisa didekorasi, dites, diinjeksi, dan dikomposisi.

---

### Question 4

> Apa tanda Visitor digunakan salah?

Jawaban:

Tanda kuatnya: domain object hanya data bag, visitor membaca terlalu banyak detail internal, banyak method visitor kosong, default method return null, visitor melakukan I/O side effect, atau menambah subtype menjadi terlalu mahal karena satu visitor interface terlalu besar.

---

### Question 5

> Bagaimana memilih antara Visitor dan Strategy?

Jawaban:

Jika variasi behavior terutama karena subtype object, Visitor/polymorphism/switch lebih natural. Jika variasi behavior terutama karena policy/configuration/runtime selection, Strategy lebih natural. Visitor menjawab “untuk subtype ini, operasi ini bagaimana?” Strategy menjawab “algoritma mana yang dipilih untuk problem ini?”

---

## 41. Practical Heuristics

Gunakan heuristik berikut:

```text
1. Jangan mulai dari Visitor.
2. Mulai dari domain model yang jelas.
3. Jika behavior core, pakai polymorphism.
4. Jika hierarchy closed dan operasi kecil, pakai sealed switch.
5. Jika operasi banyak dan eksternal, pertimbangkan Visitor.
6. Jika branching tersebar, refactor ke Visitor atau mapper terpusat.
7. Jika subtype sering bertambah, hati-hati dengan Visitor.
8. Jika visitor butuh banyak private detail, cek ulang encapsulation.
9. Jika visitor melakukan side effect, cek ulang transaction/idempotency.
10. Jika visitor interface membesar, split boundary.
```

---

## 42. Summary

Visitor adalah pattern untuk memisahkan operasi dari struktur object, terutama ketika tipe data relatif stabil tetapi operasi terhadap tipe tersebut sering bertambah.

Mental model utamanya adalah matriks:

```text
Tipe data x Operasi
```

Polymorphism memudahkan penambahan subtype.

Visitor memudahkan penambahan operasi.

Pattern matching switch dengan sealed hierarchy memberi alternatif modern yang sering lebih sederhana.

Di Java 8–25, Visitor harus dipakai lebih selektif:

```text
Java 8  : lambda membuat beberapa strategy/operation lebih ringan.
Java 17 : records + sealed classes membuat closed hierarchy lebih eksplisit.
Java 21+: pattern matching switch membuat banyak Visitor kecil tidak perlu.
Java 25 : arah Java modern makin mendukung explicit modeling dan exhaustive reasoning.
```

Pattern ini kuat jika dipakai untuk:

```text
AST
rule expression tree
workflow node
case decision projection
report/audit/email/API mapping
```

Pattern ini buruk jika dipakai untuk:

```text
semua domain behavior
menghindari responsibility object
menyembunyikan side effect
membuat data bag domain model
mengganti if-else kecil dengan ceremony besar
```

Prinsip akhirnya:

```text
Visitor bukan tujuan.
Visitor adalah alat untuk mengendalikan lokasi perubahan.
Gunakan ketika alat itu benar-benar menurunkan risiko perubahan,
bukan hanya karena pattern-nya terdengar sophisticated.
```

---

# Status Seri

```text
Part 15 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
16-behavioral-iterator-stream-collector-fluent-api.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./14-behavioral-state-state-machine-workflow-object.md">⬅️ Behavioral Pattern VI: State, State Machine, Workflow Object</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./16-behavioral-iterator-stream-collector-fluent-api.md">Part 16 — Behavioral Pattern VII: Iterator, Stream, Collector, Fluent API ➡️</a>
</div>
