# 09 — Structural Pattern III: Composite, Bridge, Flyweight, Module Boundary

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Part: 09 dari 35  
> Target: Java 8 sampai Java 25  
> Fokus: struktur objek berskala besar, tree/domain hierarchy, pemisahan axis perubahan, memory sharing, dan boundary modular yang benar-benar menahan coupling.

---

## 0. Executive Summary

Pada part sebelumnya kita membahas structural pattern yang banyak muncul sebagai lapisan integrasi dan cross-cutting behavior: Adapter, Facade, Gateway, Anti-Corruption Layer, Decorator, Proxy, Interceptor, dan Middleware Chain.

Part ini masuk ke structural pattern yang lebih sering berhubungan dengan **bentuk internal model** dan **struktur sistem jangka panjang**:

1. **Composite**  
   Cara memodelkan struktur pohon sehingga node tunggal dan kumpulan node bisa diperlakukan secara seragam.

2. **Bridge**  
   Cara memisahkan dua axis perubahan supaya class hierarchy tidak meledak secara kombinatorial.

3. **Flyweight**  
   Cara menghemat memory dengan memisahkan state yang bisa dibagi dari state yang unik per konteks.

4. **Module Boundary**  
   Cara membuat struktur package/module yang menahan coupling, bukan sekadar folder rapi.

Keempatnya punya satu tema besar:

```text
Structural design is about controlling shape.

Shape of object graph.
Shape of inheritance hierarchy.
Shape of memory usage.
Shape of module dependency.
```

Top engineer tidak hanya bertanya:

```text
Pattern apa yang cocok?
```

Tetapi bertanya:

```text
Struktur apa yang akan tumbuh dari desain ini setelah 6 bulan?
Apakah hierarchy ini akan stabil?
Apakah perubahan requirement akan menambah class, menambah if, atau memecah boundary?
Apakah object graph ini bisa dipahami, dites, diobservasi, dan di-debug?
Apakah memory cost-nya proporsional terhadap business value?
Apakah module boundary ini benar-benar mencegah domain infection?
```

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami Composite bukan hanya sebagai pattern tree, tetapi sebagai cara mengelola **recursive domain structure**.
2. Membedakan kapan struktur tree layak dimodelkan sebagai Composite, kapan cukup memakai list/graph biasa.
3. Mendesain Composite yang aman terhadap mutation, traversal, cycle, depth explosion, dan broken invariant.
4. Memahami Bridge sebagai pemisahan **abstraction axis** dan **implementation axis**.
5. Membedakan Bridge dari Strategy, Adapter, dan Dependency Injection.
6. Mengenali class explosion akibat dua atau lebih axis perubahan yang digabung dalam satu inheritance hierarchy.
7. Memahami Flyweight sebagai pemisahan **intrinsic state** dan **extrinsic state**.
8. Menghindari kesalahan umum: menganggap Flyweight sama dengan object pooling atau caching biasa.
9. Mendesain Flyweight yang aman secara concurrency, identity, lifecycle, dan memory pressure.
10. Memahami module boundary sebagai structural pattern pada level package, JPMS module, Gradle/Maven module, atau bounded context internal.
11. Membedakan folder structure yang rapi dari boundary yang enforceable.
12. Mampu membaca codebase dan menemukan smell seperti fake modularity, abstraction explosion, tree mutation chaos, dan premature flyweight.
13. Mampu melakukan refactoring bertahap menuju struktur yang lebih stabil.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Bayangkan sistem enterprise Java besar dengan domain seperti regulatory enforcement, case management, application processing, workflow approval, dan integration dengan sistem eksternal.

Lama-lama kamu akan menemukan masalah seperti ini:

### 2.1 Struktur Hierarki Domain Semakin Rumit

Contoh:

```text
Case
 ├── Section
 │    ├── Finding
 │    ├── Finding
 │    └── Recommendation
 ├── EvidenceBundle
 │    ├── DocumentEvidence
 │    ├── PhotoEvidence
 │    └── StatementEvidence
 └── DecisionPackage
      ├── ApprovalDecision
      ├── SanctionDecision
      └── AppealDecision
```

Awalnya cukup dengan `List<Document>` atau `List<Item>`. Tetapi kemudian muncul:

- nested section,
- total calculation,
- recursive validation,
- recursive access control,
- recursive rendering,
- recursive audit,
- move/reorder node,
- copy subtree,
- lock subtree,
- archive subtree.

Tanpa struktur yang benar, service layer akan penuh kode seperti:

```java
if (item.getType().equals("SECTION")) {
    for (Item child : item.getChildren()) {
        // recursive logic here
    }
} else if (item.getType().equals("DOCUMENT")) {
    // document logic
} else if (item.getType().equals("EVIDENCE")) {
    // evidence logic
}
```

Ini smell bahwa struktur domain recursive belum dimodelkan secara jelas.

---

### 2.2 Class Hierarchy Meledak Karena Kombinasi Variasi

Contoh laporan:

```text
Format:
- PDF
- Excel
- HTML

Delivery:
- Email
- SFTP
- Browser download
- Object storage

Audience:
- Internal officer
- External applicant
- Management
```

Desain buruk bisa menghasilkan class seperti:

```text
InternalPdfEmailReport
InternalPdfSftpReport
InternalExcelEmailReport
ExternalPdfEmailReport
ExternalHtmlBrowserReport
ManagementExcelStorageReport
...
```

Jika ada 3 format x 4 delivery x 3 audience = 36 class.  
Jika tambah language, signing mode, watermark mode, retention mode, jumlahnya bisa meledak.

Masalahnya bukan banyak class. Masalahnya adalah **axis perubahan tercampur**.

---

### 2.3 Memory Boros Karena Jutaan Objek Membawa State yang Sama

Contoh:

```text
10 juta rendered table cells
masing-masing menyimpan font, color, alignment, border, validation rule, label metadata
```

Padahal sebagian besar cell menggunakan style yang sama.

Tanpa Flyweight:

```text
Cell 1 -> new Style("Arial", 12, BLACK, LEFT, THIN)
Cell 2 -> new Style("Arial", 12, BLACK, LEFT, THIN)
Cell 3 -> new Style("Arial", 12, BLACK, LEFT, THIN)
...
```

Dengan Flyweight:

```text
Cell -> reference ke shared Style
```

Tetapi jika Flyweight dipakai tanpa pemahaman, bisa muncul bug identity, memory leak, stale cache, dan object sharing yang tidak thread-safe.

---

### 2.4 Struktur Package Rapi, Tapi Coupling Tetap Bocor

Contoh folder:

```text
com.company.case
com.company.application
com.company.profile
com.company.document
com.company.notification
```

Kelihatannya modular. Tetapi di dalamnya:

```java
case.service.CaseService
    calls application.repository.ApplicationRepository
    calls profile.entity.ProfileEntity
    calls document.internal.S3DocumentClient
    calls notification.email.EmailTemplateRepository
```

Package sudah dipisah, tetapi dependency tidak dikontrol. Ini bukan modularity. Ini hanya foldering.

Module boundary yang benar harus menjawab:

```text
Siapa boleh memanggil siapa?
Model apa yang boleh keluar boundary?
Interface apa yang dianggap public?
Apakah dependency direction enforceable?
Apakah internal package benar-benar internal?
Apakah test bisa membuktikan boundary tidak bocor?
```

---

## 3. Mental Model Besar

Part ini berangkat dari satu mental model:

```text
Structural pattern mengontrol bentuk pertumbuhan sistem.
```

Bukan hanya bentuk class hari ini, tetapi bentuk sistem saat requirement bertambah.

---

## 4. Composite Pattern

### 4.1 Intent

Composite adalah structural pattern untuk menyusun objek ke dalam struktur tree sehingga client bisa memperlakukan objek individual dan composite object secara seragam.

Secara sederhana:

```text
Leaf     = node tanpa children
Composite = node dengan children
Client   = bisa berinteraksi dengan keduanya lewat interface yang sama
```

Bentuk umum:

```text
Component
 ├── Leaf
 └── Composite
       ├── Component
       ├── Component
       └── Component
```

---

### 4.2 Masalah yang Diselesaikan Composite

Composite cocok ketika domain punya struktur seperti:

```text
whole-part hierarchy
nested item
recursive structure
tree-like object graph
```

Contoh Java enterprise:

1. Menu dan submenu.
2. Organization unit dan sub-unit.
3. Document section dan paragraph/table/image.
4. Workflow stage dan sub-stage.
5. Case file, folder, document, evidence.
6. Permission tree.
7. Form schema dengan section, group, field.
8. UI component tree.
9. Rule group dan rule leaf.
10. Product bundle dan item.

---

### 4.3 Composite Bukan Sekadar `List<Child>`

Banyak engineer mengira Composite hanya berarti sebuah class punya list children.

Itu belum tentu Composite.

Composite pattern muncul ketika:

1. Ada common abstraction untuk leaf dan parent.
2. Client bisa menjalankan operasi yang sama tanpa terlalu peduli jenis node.
3. Operasi sering bersifat recursive.
4. Struktur tree adalah bagian dari domain, bukan incidental data structure.

Contoh bukan Composite:

```java
class User {
    private List<Role> roles;
}
```

Ini hanya association.

Contoh lebih dekat ke Composite:

```java
interface CaseNode {
    NodeId id();
    String title();
    List<CaseNode> children();
    ValidationResult validate(ValidationContext context);
}

final class EvidenceItem implements CaseNode {
    private final NodeId id;
    private final String title;

    @Override
    public List<CaseNode> children() {
        return List.of();
    }

    @Override
    public ValidationResult validate(ValidationContext context) {
        return ValidationResult.ok();
    }
}

final class CaseSection implements CaseNode {
    private final NodeId id;
    private final String title;
    private final List<CaseNode> children;

    @Override
    public List<CaseNode> children() {
        return children;
    }

    @Override
    public ValidationResult validate(ValidationContext context) {
        ValidationResult self = validateSectionTitle();
        ValidationResult nested = children.stream()
                .map(child -> child.validate(context))
                .reduce(ValidationResult.ok(), ValidationResult::combine);
        return self.combine(nested);
    }
}
```

Di sini `EvidenceItem` dan `CaseSection` sama-sama `CaseNode`.

---

## 5. Composite Anatomy

### 5.1 Component

`Component` adalah abstraction umum.

```java
public interface CaseNode {
    NodeId id();
    String title();
    List<CaseNode> children();
}
```

Pertanyaan design:

```text
Apakah semua operasi memang valid untuk semua node?
Apakah leaf harus punya children() kosong?
Apakah composite operation sebaiknya ada di node atau external service?
Apakah mutation boleh dilakukan lewat node?
Apakah traversal policy bagian dari node atau terpisah?
```

---

### 5.2 Leaf

Leaf adalah node terminal.

```java
public final class FindingNode implements CaseNode {
    private final NodeId id;
    private final String title;
    private final Finding finding;

    @Override
    public List<CaseNode> children() {
        return List.of();
    }
}
```

Leaf tidak punya children. Tetapi hati-hati: membuat `children()` tersedia di leaf bisa menimbulkan ambiguity.

Apakah leaf dengan children kosong berarti:

```text
node memang leaf
atau children belum loaded
atau caller tidak punya permission melihat children
atau data corrupt
```

Dalam domain penting, ambiguity ini harus dihindari.

---

### 5.3 Composite

Composite menyimpan child component.

```java
public final class SectionNode implements CaseNode {
    private final NodeId id;
    private final String title;
    private final List<CaseNode> children;

    public SectionNode(NodeId id, String title, List<CaseNode> children) {
        this.id = Objects.requireNonNull(id);
        this.title = requireNonBlank(title);
        this.children = List.copyOf(children);
    }

    @Override
    public List<CaseNode> children() {
        return children;
    }
}
```

Poin penting:

```text
List.copyOf(children) membuat snapshot immutable.
```

Ini mencegah caller mengubah struktur tree dari luar.

---

## 6. Composite dengan Java Modern

### 6.1 Composite dengan Sealed Interface

Java modern mendukung sealed class/interface. Ini berguna ketika jenis node memang closed set.

```java
public sealed interface CaseNode
        permits SectionNode, FindingNode, EvidenceNode, DecisionNode {

    NodeId id();
    String title();
}

public record FindingNode(
        NodeId id,
        String title,
        Finding finding
) implements CaseNode { }

public record SectionNode(
        NodeId id,
        String title,
        List<CaseNode> children
) implements CaseNode {
    public SectionNode {
        children = List.copyOf(children);
    }
}
```

Keuntungannya:

1. Compiler tahu semua subtype yang valid.
2. Pattern matching switch menjadi lebih aman.
3. Domain hierarchy lebih eksplisit.
4. Subclass liar dari module lain bisa dicegah.

Contoh traversal dengan pattern matching switch:

```java
public int countFindings(CaseNode node) {
    return switch (node) {
        case FindingNode ignored -> 1;
        case EvidenceNode ignored -> 0;
        case DecisionNode ignored -> 0;
        case SectionNode section -> section.children().stream()
                .mapToInt(this::countFindings)
                .sum();
    };
}
```

Catatan: syntax pattern matching switch bergantung versi Java yang dipakai. Pada seri ini konsep berlaku untuk Java modern, tetapi production code harus mengikuti versi compiler aktual di project.

---

### 6.2 Composite dengan Record

Record cocok untuk node immutable yang terutama membawa state.

```java
public record EvidenceNode(
        NodeId id,
        String title,
        EvidenceRef evidenceRef
) implements CaseNode {
    public EvidenceNode {
        Objects.requireNonNull(id);
        title = requireNonBlank(title);
        Objects.requireNonNull(evidenceRef);
    }
}
```

Namun record tidak otomatis membuat seluruh graph aman. Jika record punya field `List`, isi list tetap perlu disalin.

```java
public record SectionNode(
        NodeId id,
        String title,
        List<CaseNode> children
) implements CaseNode {
    public SectionNode {
        children = List.copyOf(children);
    }
}
```

Tanpa `List.copyOf`, caller masih bisa memodifikasi list asli.

---

## 7. Composite Design Decision

### 7.1 Apakah Operasi Ditaruh di Node atau di Service?

Ada dua gaya:

#### Gaya A — Behavior di Node

```java
interface CaseNode {
    ValidationResult validate(ValidationContext context);
}
```

Keuntungan:

1. Behavior dekat dengan data.
2. Polymorphism natural.
3. Mengurangi `if type` di service.

Kelemahan:

1. Node bisa menjadi terlalu berat.
2. Node bisa tercemar dependency teknis.
3. Sulit jika operasi sering bertambah.

---

#### Gaya B — Behavior di External Traversal/Visitor/Service

```java
final class CaseTreeValidator {
    ValidationResult validate(CaseNode node, ValidationContext context) {
        return switch (node) {
            case FindingNode finding -> validateFinding(finding, context);
            case EvidenceNode evidence -> validateEvidence(evidence, context);
            case DecisionNode decision -> validateDecision(decision, context);
            case SectionNode section -> validateSection(section, context);
        };
    }
}
```

Keuntungan:

1. Node tetap ringan.
2. Operasi bisa dipisah per use case.
3. Lebih mudah menjaga dependency node tetap bersih.

Kelemahan:

1. Bisa muncul banyak switch/type branching.
2. Jika subtype sering bertambah, banyak service harus diubah.
3. Bisa menuju Visitor pattern.

---

### 7.2 Heuristik

Gunakan behavior di node jika:

```text
operasi adalah invariant intrinsik node,
operasi stabil,
dependency operasi tidak teknis,
semua node memang punya makna operasi tersebut.
```

Gunakan external service/traversal jika:

```text
operasi use-case specific,
operasi membutuhkan repository/gateway/security context,
operasi sering bertambah,
node harus tetap menjadi pure domain model.
```

---

## 8. Composite Failure Mode

### 8.1 Tree Mutation Chaos

Masalah:

```java
section.children().add(new FindingNode(...));
```

Jika `children()` mengembalikan mutable list internal, tree bisa diubah tanpa invariant check.

Konsekuensi:

1. Parent-child relation tidak konsisten.
2. Audit tidak terekam.
3. Authorization bypass.
4. Dirty checking ORM kacau.
5. Concurrent modification.
6. Validation tidak jalan.

Solusi:

```java
public List<CaseNode> children() {
    return children;
}
```

Dengan syarat `children` sudah immutable.

```java
this.children = List.copyOf(children);
```

Jika mutation diperlukan, pakai method eksplisit:

```java
public SectionNode addChild(CaseNode child) {
    validateCanAdd(child);
    List<CaseNode> updated = new ArrayList<>(children);
    updated.add(child);
    return new SectionNode(id, title, updated);
}
```

---

### 8.2 Cycle di Struktur yang Seharusnya Tree

Composite biasanya tree, bukan graph. Tetapi bug bisa membuat cycle:

```text
A -> B -> C -> A
```

Traversal recursive akan infinite loop.

Solusi:

```java
public final class CycleSafeTraversal {
    public void traverse(CaseNode root, Consumer<CaseNode> consumer) {
        Set<NodeId> visited = new HashSet<>();
        traverse(root, consumer, visited);
    }

    private void traverse(CaseNode node,
                          Consumer<CaseNode> consumer,
                          Set<NodeId> visited) {
        if (!visited.add(node.id())) {
            throw new InvalidTreeException("Cycle detected at node " + node.id());
        }

        consumer.accept(node);

        if (node instanceof SectionNode section) {
            for (CaseNode child : section.children()) {
                traverse(child, consumer, visited);
            }
        }
    }
}
```

Dalam domain enterprise, cycle detection sebaiknya dilakukan saat:

1. import data,
2. save/update tree,
3. move node,
4. rebuild tree dari database,
5. migration script.

---

### 8.3 Depth Explosion

Recursive traversal bisa stack overflow jika depth ekstrem.

Contoh:

```text
section -> section -> section -> ... 100000 level
```

Solusi:

1. Batasi max depth secara domain.
2. Gunakan iterative traversal jika depth tidak bisa dikontrol.
3. Validasi saat write.

Iterative traversal:

```java
public List<CaseNode> flatten(CaseNode root) {
    List<CaseNode> result = new ArrayList<>();
    Deque<CaseNode> stack = new ArrayDeque<>();
    stack.push(root);

    while (!stack.isEmpty()) {
        CaseNode current = stack.pop();
        result.add(current);

        if (current instanceof SectionNode section) {
            List<CaseNode> children = section.children();
            for (int i = children.size() - 1; i >= 0; i--) {
                stack.push(children.get(i));
            }
        }
    }

    return result;
}
```

---

### 8.4 Uniform Interface yang Bohong

Kadang kita memaksa leaf punya method yang tidak masuk akal.

```java
interface Node {
    void add(Node child);
    void remove(Node child);
    List<Node> children();
}
```

Leaf akhirnya melakukan:

```java
@Override
public void add(Node child) {
    throw new UnsupportedOperationException();
}
```

Ini bisa jadi smell.

Lebih baik pisahkan:

```java
sealed interface CaseNode permits SectionNode, FindingNode { }

interface ParentNode extends CaseNode {
    List<CaseNode> children();
}
```

Atau gunakan pattern matching:

```java
if (node instanceof ParentNode parent) {
    parent.children();
}
```

Uniformity bagus hanya jika operasi memang bermakna untuk semua node.

---

## 9. Composite vs Visitor

Composite menempatkan variasi utama pada object structure. Visitor menempatkan variasi utama pada operasi.

```text
Composite cocok jika jenis operasi stabil, tetapi struktur node bisa bervariasi.
Visitor cocok jika struktur node stabil, tetapi operasi sering bertambah.
```

Contoh Composite-heavy:

```java
node.validate(context);
node.render(context);
node.calculate(context);
```

Contoh Visitor-heavy:

```java
validator.visit(node);
renderer.visit(node);
calculator.visit(node);
exporter.visit(node);
```

Dengan Java modern, sealed class + pattern matching switch bisa menjadi alternatif Visitor untuk closed hierarchy.

Namun jangan otomatis mengganti Visitor dengan switch. Jika operasi banyak, Visitor masih bisa memberi struktur yang lebih eksplisit.

---

## 10. Bridge Pattern

### 10.1 Intent

Bridge memisahkan abstraction dari implementation agar keduanya bisa berubah secara independen.

Bentuk umum:

```text
Abstraction ----uses---- Implementor
     |                       |
RefinedAbstraction      ConcreteImplementor
```

Bridge berguna ketika ada dua axis variasi yang jika digabung akan menyebabkan class explosion.

---

### 10.2 Masalah yang Diselesaikan Bridge

Misalnya sistem notifikasi punya variasi:

```text
Notification type:
- CaseAssignedNotification
- AppealSubmittedNotification
- LicenseExpiryNotification

Delivery channel:
- Email
- SMS
- Push
- Inbox
```

Desain inheritance buruk:

```text
EmailCaseAssignedNotification
SmsCaseAssignedNotification
PushCaseAssignedNotification
InboxCaseAssignedNotification
EmailAppealSubmittedNotification
SmsAppealSubmittedNotification
...
```

Bridge memisahkan:

```text
Notification abstraction
Delivery implementation
```

---

### 10.3 Contoh Bridge

```java
public interface DeliveryChannel {
    DeliveryReceipt deliver(Message message);
}

public final class EmailDeliveryChannel implements DeliveryChannel {
    private final EmailGateway gateway;

    public EmailDeliveryChannel(EmailGateway gateway) {
        this.gateway = gateway;
    }

    @Override
    public DeliveryReceipt deliver(Message message) {
        return gateway.sendEmail(message.toEmailRequest());
    }
}

public final class InboxDeliveryChannel implements DeliveryChannel {
    private final InboxRepository inboxRepository;

    public InboxDeliveryChannel(InboxRepository inboxRepository) {
        this.inboxRepository = inboxRepository;
    }

    @Override
    public DeliveryReceipt deliver(Message message) {
        InboxEntry saved = inboxRepository.save(message.toInboxEntry());
        return DeliveryReceipt.success(saved.id());
    }
}
```

Abstraction:

```java
public abstract class Notification {
    private final DeliveryChannel deliveryChannel;

    protected Notification(DeliveryChannel deliveryChannel) {
        this.deliveryChannel = Objects.requireNonNull(deliveryChannel);
    }

    public final DeliveryReceipt send(NotificationContext context) {
        Message message = composeMessage(context);
        return deliveryChannel.deliver(message);
    }

    protected abstract Message composeMessage(NotificationContext context);
}

public final class CaseAssignedNotification extends Notification {
    public CaseAssignedNotification(DeliveryChannel deliveryChannel) {
        super(deliveryChannel);
    }

    @Override
    protected Message composeMessage(NotificationContext context) {
        return Message.of(
                context.recipient(),
                "Case Assigned",
                "Case " + context.caseNo() + " has been assigned to you."
        );
    }
}
```

Client:

```java
DeliveryChannel channel = new EmailDeliveryChannel(emailGateway);
Notification notification = new CaseAssignedNotification(channel);
notification.send(context);
```

Sekarang type notification dan delivery channel bisa berubah independen.

---

## 11. Bridge vs Strategy

Bridge dan Strategy mirip karena sama-sama memakai composition.

Perbedaannya ada pada intent.

### 11.1 Strategy

Strategy mengganti algoritma/perilaku.

```text
PaymentService uses FeeCalculationStrategy
```

Pertanyaannya:

```text
Algoritma mana yang dipakai?
```

---

### 11.2 Bridge

Bridge memisahkan abstraction hierarchy dari implementation hierarchy.

```text
Notification abstraction uses DeliveryChannel implementation
```

Pertanyaannya:

```text
Bagaimana dua axis variasi bisa tumbuh terpisah?
```

---

### 11.3 Heuristik

Gunakan Strategy jika:

```text
hanya ada satu axis variasi utama,
perilaku mudah diganti,
client memilih algoritma/policy.
```

Gunakan Bridge jika:

```text
ada dua hierarchy/axis yang sama-sama dapat berkembang,
jika digabung akan menyebabkan class explosion,
abstraction dan implementation perlu release/lifecycle berbeda.
```

---

## 12. Bridge vs Adapter

Adapter menyamakan interface yang tidak kompatibel.

Bridge memisahkan abstraction dari implementation sejak desain awal.

```text
Adapter = make incompatible thing fit
Bridge  = prevent abstraction and implementation from being coupled
```

Contoh Adapter:

```java
class LegacySmsGatewayAdapter implements DeliveryChannel {
    private final LegacySmsClient client;

    @Override
    public DeliveryReceipt deliver(Message message) {
        LegacySmsRequest request = convert(message);
        LegacySmsResponse response = client.send(request);
        return convert(response);
    }
}
```

Adapter bisa menjadi implementor dalam Bridge.

```text
Notification --Bridge--> DeliveryChannel --Adapter--> LegacySmsClient
```

---

## 13. Bridge Failure Mode

### 13.1 Abstraction Explosion

Bridge dibuat untuk mengurangi class explosion, tetapi bisa membuat abstraction explosion jika semua variasi dibuat interface terlalu dini.

Smell:

```text
1 implementation per interface
nama interface tidak punya semantic value
semua service punya bridge padahal tidak ada dua axis variasi
banyak class kecil hanya pass-through
```

Contoh buruk:

```java
interface UserNameProvider {
    String getUserName(User user);
}

class DefaultUserNameProvider implements UserNameProvider {
    public String getUserName(User user) {
        return user.getName();
    }
}
```

Ini bukan Bridge. Ini abstraction tanpa force.

---

### 13.2 Axis Salah Dipisahkan

Misalnya kamu memisahkan `PdfReport` dan `ExcelReport`, tetapi sebenarnya variasi yang sering berubah adalah:

```text
audience-specific field selection
```

Maka Bridge format/delivery tidak menyelesaikan masalah utama.

Sebelum membuat Bridge, tanya:

```text
Axis mana yang benar-benar berubah independen?
Axis mana yang stabil?
Axis mana yang owner/team-nya berbeda?
Axis mana yang release cadence-nya berbeda?
Axis mana yang membuat class explosion nyata?
```

---

### 13.3 Bridge yang Menyembunyikan Dependency Mahal

Contoh:

```java
notification.send(context);
```

Terlihat murah, tetapi implementor melakukan:

```text
render template
query database
call external API
upload attachment
send email
```

Solusi:

1. Nama method harus jujur.
2. Dokumentasikan side effect.
3. Return receipt/error yang eksplisit.
4. Observability wajib.
5. Timeout dan retry boundary jelas.

---

## 14. Flyweight Pattern

### 14.1 Intent

Flyweight mengurangi konsumsi memory dengan membagi state yang sama antar banyak object.

Konsep utama:

```text
Intrinsic state = state yang bisa dibagi/shared
Extrinsic state = state yang unik per context/caller
```

Flyweight menyimpan intrinsic state. Extrinsic state diberikan dari luar saat operasi dijalankan.

---

### 14.2 Masalah yang Diselesaikan Flyweight

Flyweight cocok ketika:

1. Jumlah object sangat besar.
2. Banyak object memiliki state berulang yang sama.
3. State bisa dipisah menjadi shared dan per-context.
4. Memory pressure nyata dan terukur.
5. Shared state immutable atau effectively immutable.

Contoh:

1. Text rendering glyph/style.
2. Cell style dalam spreadsheet/export besar.
3. Permission descriptor yang dipakai jutaan assignment.
4. Postal code metadata yang banyak direferensikan.
5. Static rule definition yang dievaluasi terhadap banyak subject.
6. Product/catalog metadata yang dipakai banyak transaction line.
7. UI icon/style/theme descriptor.

---

### 14.3 Contoh Tanpa Flyweight

```java
public final class ReportCell {
    private final int row;
    private final int column;
    private final String value;
    private final String fontName;
    private final int fontSize;
    private final String color;
    private final String alignment;
    private final String border;

    public ReportCell(int row, int column, String value,
                      String fontName, int fontSize,
                      String color, String alignment, String border) {
        this.row = row;
        this.column = column;
        this.value = value;
        this.fontName = fontName;
        this.fontSize = fontSize;
        this.color = color;
        this.alignment = alignment;
        this.border = border;
    }
}
```

Jika ada jutaan cell dan style berulang, memory boros.

---

### 14.4 Contoh Dengan Flyweight

Intrinsic state:

```java
public record CellStyle(
        String fontName,
        int fontSize,
        String color,
        String alignment,
        String border
) { }
```

Flyweight factory:

```java
public final class CellStyleRegistry {
    private final ConcurrentMap<CellStyle, CellStyle> styles = new ConcurrentHashMap<>();

    public CellStyle intern(CellStyle style) {
        return styles.computeIfAbsent(style, Function.identity());
    }

    public int size() {
        return styles.size();
    }
}
```

Cell:

```java
public final class ReportCell {
    private final int row;
    private final int column;
    private final String value;
    private final CellStyle style;

    public ReportCell(int row, int column, String value, CellStyle style) {
        this.row = row;
        this.column = column;
        this.value = value;
        this.style = style;
    }
}
```

Sekarang style yang sama bisa dipakai bersama.

---

## 15. Flyweight Bukan Object Pool

Object pool mengelola reuse object instance yang mahal dibuat.

Flyweight mengelola shared immutable state.

```text
Object Pool:
- borrow object
- use object
- return object
- object mungkin mutable
- lifecycle kompleks

Flyweight:
- shared object
- biasanya immutable
- tidak dipinjam/dikembalikan
- state unik diberikan dari luar
```

Object pool modern jarang dibutuhkan di Java application biasa kecuali resource sangat mahal seperti connection. Bahkan connection pool seperti HikariCP adalah pool resource I/O, bukan Flyweight.

Jangan membuat pool untuk object kecil hanya karena ingin “hemat”. JVM modern sangat baik mengalokasikan short-lived object.

---

## 16. Flyweight Failure Mode

### 16.1 Premature Flyweight

Flyweight menambah kompleksitas. Jangan dipakai sebelum memory pressure terbukti.

Tanda premature:

```text
object count kecil
memory bukan bottleneck
profiling belum dilakukan
shared state tidak jelas
factory/cache lebih kompleks dari domain logic
```

Gunakan profiling sebelum memutuskan.

---

### 16.2 Mutable Shared State

Bug besar terjadi jika shared object mutable.

```java
public final class CellStyle {
    private String color;

    public void setColor(String color) {
        this.color = color;
    }
}
```

Jika banyak cell berbagi style yang sama, mengubah satu style mengubah semua cell.

Solusi:

1. Buat flyweight immutable.
2. Jangan expose mutable internal state.
3. Gunakan record/value object jika cocok.
4. Treat shared object as value.

---

### 16.3 Memory Leak dari Registry Tidak Terbatas

```java
private final ConcurrentMap<CellStyle, CellStyle> styles = new ConcurrentHashMap<>();
```

Jika key bisa tumbuh tak terbatas, registry menjadi memory leak.

Contoh buruk:

```text
style key memasukkan timestamp
style key memasukkan user-specific random color
style key memasukkan request id
```

Solusi:

1. Pastikan cardinality bounded.
2. Gunakan eviction jika tidak bounded.
3. Monitor registry size.
4. Jangan memasukkan extrinsic state ke key.
5. Pertimbangkan weak reference dengan hati-hati.

---

### 16.4 Equality/HashCode Salah

Flyweight registry bergantung pada equality.

Jika `equals/hashCode` salah, sharing gagal atau salah sharing.

Record membantu karena equality berbasis komponen.

```java
public record PermissionDescriptor(
        String module,
        String action,
        String resourceType
) { }
```

Namun pastikan field benar-benar intrinsic. Jangan masukkan userId jika descriptor harus shared antar user.

---

## 17. Module Boundary sebagai Structural Pattern

### 17.1 Kenapa Module Boundary Masuk Structural Pattern?

Structural pattern biasanya dibahas pada level class/object. Tetapi di sistem enterprise, struktur yang paling menentukan evolusi bukan hanya class, melainkan module boundary.

Module boundary adalah cara mengatur:

```text
ownership
visibility
dependency direction
model exposure
release impact
test boundary
change isolation
```

Tanpa module boundary, design pattern di level class sering kalah oleh coupling antar module.

---

### 17.2 Folder Bukan Boundary

Struktur folder:

```text
case/
application/
document/
notification/
```

Belum tentu modular.

Boundary nyata membutuhkan minimal:

1. Public API yang jelas.
2. Internal implementation yang tidak boleh dipakai module lain.
3. Dependency direction yang terkontrol.
4. Model yang tidak bocor sembarangan.
5. Enforcement lewat build/test/static analysis jika memungkinkan.

---

### 17.3 Package Boundary

Contoh struktur:

```text
com.acme.casehandling
 ├── api
 │    ├── CaseCommandService.java
 │    ├── CaseQueryService.java
 │    ├── CaseSummary.java
 │    └── SubmitCaseCommand.java
 ├── domain
 │    ├── Case.java
 │    ├── CaseStatus.java
 │    └── CasePolicy.java
 ├── application
 │    └── DefaultCaseCommandService.java
 ├── infrastructure
 │    ├── JpaCaseRepository.java
 │    └── CaseEventOutboxWriter.java
 └── internal
      └── CaseNumberGenerator.java
```

Module lain hanya boleh pakai:

```text
com.acme.casehandling.api
```

Tidak boleh langsung pakai:

```text
com.acme.casehandling.domain
com.acme.casehandling.infrastructure
com.acme.casehandling.internal
```

Dalam Java tanpa JPMS, ini biasanya enforce lewat:

1. convention,
2. architecture test,
3. build module split,
4. package-private visibility,
5. ArchUnit-like rules,
6. code review discipline.

---

### 17.4 JPMS Module Boundary

Java Platform Module System memberi mekanisme `exports` dan `requires`.

Contoh:

```java
module com.acme.casehandling {
    exports com.acme.casehandling.api;

    requires com.acme.common;
    requires java.sql;
}
```

Package yang tidak di-export tidak menjadi public API module.

Namun JPMS bukan silver bullet.

Masalah tetap bisa muncul jika:

```text
API module mengekspor entity internal,
module saling requires secara cyclic,
semua package di-export,
boundary terlalu teknis bukan domain-oriented,
reflection membuka semua package tanpa kontrol.
```

---

### 17.5 Gradle/Maven Module Boundary

Sering kali lebih realistis di enterprise Java menggunakan multi-module build.

Contoh:

```text
case-api
case-application
case-domain
case-infrastructure
application-api
application-application
application-domain
application-infrastructure
```

Tetapi terlalu banyak module juga bisa menghambat.

Heuristik:

```text
Gunakan module build ketika dependency perlu benar-benar dicegah.
Gunakan package boundary + architecture test ketika split fisik terlalu mahal.
Gunakan JPMS ketika runtime/module encapsulation relevan dan ecosystem mendukung.
```

---

## 18. Module Boundary Pattern

### 18.1 Public API Package

Public API module berisi contract untuk module lain.

```java
package com.acme.casehandling.api;

public interface CaseCommandService {
    CaseId submit(SubmitCaseCommand command);
    void assign(AssignCaseCommand command);
    void close(CloseCaseCommand command);
}
```

DTO API:

```java
public record SubmitCaseCommand(
        ApplicantId applicantId,
        ApplicationId applicationId,
        String submissionReason
) { }
```

Jangan expose entity internal:

```java
// buruk
public interface CaseCommandService {
    Case submit(Case caseEntity);
}
```

Karena module lain jadi tahu entity internal.

---

### 18.2 Internal Domain Model

```java
package com.acme.casehandling.domain;

final class Case {
    private final CaseId id;
    private CaseStatus status;

    void assign(OfficerId officerId) {
        if (!status.canAssign()) {
            throw new IllegalCaseTransitionException(status, CaseAction.ASSIGN);
        }
        this.status = CaseStatus.ASSIGNED;
    }
}
```

Jika domain model bisa dibuat package-private, boundary lebih kuat.

Namun framework seperti JPA sering memaksa visibility tertentu. Jangan biarkan framework menentukan seluruh desain domain tanpa sadar.

---

### 18.3 Application Service sebagai Module Facade

```java
package com.acme.casehandling.application;

public final class DefaultCaseCommandService implements CaseCommandService {
    private final CaseRepository repository;
    private final CasePolicy policy;
    private final CaseEventPublisher eventPublisher;

    @Override
    public CaseId submit(SubmitCaseCommand command) {
        policy.checkSubmissionAllowed(command.applicantId());
        Case created = Case.submit(command.applicantId(), command.applicationId());
        repository.save(created);
        eventPublisher.publish(CaseSubmitted.from(created));
        return created.id();
    }
}
```

Application service menjadi facade boundary untuk module.

---

### 18.4 Infrastructure Tidak Boleh Menjadi API

Buruk:

```java
otherModule.call(caseJpaRepository.findById(...));
```

Lebih baik:

```java
otherModule.call(caseQueryService.findSummary(...));
```

Repository adalah detail persistence module, bukan integration API antar module.

---

## 19. Fake Modularity

Fake modularity adalah kondisi ketika struktur terlihat modular, tetapi coupling tetap bebas.

### 19.1 Gejala

```text
module A import class internal module B
repository module B dipakai langsung oleh module A
entity module B dipakai sebagai DTO module A
cyclic dependency antar package
shared common module penuh domain logic semua module
semua service public
semua package bernama util/helper/common
```

---

### 19.2 Common Module Trap

`common` sering menjadi tempat pembuangan.

Awalnya:

```text
common.DateUtils
common.StringUtils
common.Result
```

Lalu menjadi:

```text
common.CaseStatus
common.ApplicationType
common.UserRole
common.NotificationTemplate
common.WorkflowDecision
```

Akhirnya semua module tergantung `common`, dan `common` tergantung semua konsep domain.

Ini membuat dependency graph palsu:

```text
case -> common
application -> common
profile -> common
notification -> common
```

Padahal secara semantic:

```text
common berisi domain leakage dari semua module
```

Aturan:

```text
Common hanya boleh berisi konsep yang benar-benar universal dan stabil.
Jika konsep punya owner domain tertentu, jangan masukkan common.
```

---

## 20. Composite, Bridge, Flyweight, Module Boundary dalam Satu Case Study

Misalnya kita membangun **Form Rendering Engine** untuk sistem regulatory.

Requirement:

1. Form punya section, group, field, table, attachment field.
2. Form bisa dirender sebagai HTML, PDF, dan Excel.
3. Field punya style dan validation metadata.
4. Ada banyak form submission dengan schema yang sama.
5. Domain lain hanya boleh memakai public API form module.

---

### 20.1 Composite untuk Form Schema

```java
public sealed interface FormNode permits FormSection, FormGroup, FormField {
    NodeId id();
    String label();
}

public record FormSection(
        NodeId id,
        String label,
        List<FormNode> children
) implements FormNode {
    public FormSection {
        children = List.copyOf(children);
    }
}

public record FormGroup(
        NodeId id,
        String label,
        List<FormNode> children
) implements FormNode {
    public FormGroup {
        children = List.copyOf(children);
    }
}

public record FormField(
        NodeId id,
        String label,
        FieldType type,
        FieldStyle style
) implements FormNode { }
```

---

### 20.2 Flyweight untuk FieldStyle

```java
public record FieldStyle(
        String cssClass,
        String alignment,
        boolean requiredMarker,
        int width
) { }

public final class FieldStyleRegistry {
    private final ConcurrentMap<FieldStyle, FieldStyle> interned = new ConcurrentHashMap<>();

    public FieldStyle intern(FieldStyle style) {
        return interned.computeIfAbsent(style, Function.identity());
    }
}
```

---

### 20.3 Bridge untuk Renderer dan Output Target

Abstraction:

```java
public abstract class FormRenderer {
    private final RenderTarget target;

    protected FormRenderer(RenderTarget target) {
        this.target = target;
    }

    public final RenderReceipt render(FormSchema schema, FormData data) {
        RenderedDocument document = renderDocument(schema, data);
        return target.write(document);
    }

    protected abstract RenderedDocument renderDocument(FormSchema schema, FormData data);
}
```

Implementation axis:

```java
public interface RenderTarget {
    RenderReceipt write(RenderedDocument document);
}
```

Concrete abstraction:

```java
public final class PdfFormRenderer extends FormRenderer {
    public PdfFormRenderer(RenderTarget target) {
        super(target);
    }

    @Override
    protected RenderedDocument renderDocument(FormSchema schema, FormData data) {
        // render PDF
        return RenderedDocument.pdf(...);
    }
}
```

Concrete implementor:

```java
public final class S3RenderTarget implements RenderTarget {
    private final ObjectStorageGateway storage;

    @Override
    public RenderReceipt write(RenderedDocument document) {
        StorageKey key = storage.put(document.bytes(), document.contentType());
        return RenderReceipt.stored(key);
    }
}
```

---

### 20.4 Module Boundary untuk Form Module

```text
form-api
 ├── FormRenderingService
 ├── RenderFormCommand
 ├── RenderReceipt
 └── FormSchemaRef

form-domain
 ├── FormSchema
 ├── FormNode
 ├── FormSection
 ├── FormGroup
 ├── FormField
 └── FieldStyle

form-application
 └── DefaultFormRenderingService

form-infrastructure
 ├── PdfRendererAdapter
 ├── ExcelRendererAdapter
 └── S3RenderTarget
```

Module lain hanya boleh tahu:

```java
formRenderingService.render(command);
```

Bukan:

```java
new PdfFormRenderer(new S3RenderTarget(...))
```

Karena itu detail internal form module.

---

## 21. Anti-Pattern Catalog

### 21.1 Tree Mutation Chaos

Gejala:

```text
children list mutable
parent-child invariant tidak jelas
move node tanpa cycle check
recursive operation tersebar di service
node bisa dihapus tanpa audit
```

Akibat:

```text
corrupt hierarchy
infinite recursion
missing audit
inconsistent UI
hard-to-debug persistence issue
```

Solusi:

```text
immutable children
explicit mutation method
cycle detection
max depth policy
centralized traversal utility
write-side invariant check
```

---

### 21.2 Abstraction Explosion

Gejala:

```text
interface untuk semua class
1 implementation per interface
Bridge dipakai tanpa dua axis variasi
class kecil pass-through terlalu banyak
```

Akibat:

```text
navigasi code sulit
stack trace panjang
mocking berlebihan
design terlihat sophisticated tapi miskin semantic
```

Solusi:

```text
hapus abstraction tanpa force
pakai concrete class sampai volatility nyata
buat interface di boundary, bukan setiap class
ukur abstraction dari semantic value
```

---

### 21.3 Premature Flyweight

Gejala:

```text
registry/cache dibuat sebelum profiling
memory bukan bottleneck
object count kecil
shared state tidak jelas
```

Akibat:

```text
complexity naik
bug identity/cache
memory leak registry
performance justru turun
```

Solusi:

```text
profiling dulu
ukur cardinality
gunakan immutable value
batasi registry
monitor cache size
```

---

### 21.4 Fake Modularity

Gejala:

```text
folder rapi tapi dependency bebas
internal class dipakai module lain
common module jadi dumping ground
cyclic dependency
entity persistence keluar boundary
```

Akibat:

```text
perubahan kecil menyebar
module tidak bisa dites terpisah
migrasi sulit
ownership kabur
```

Solusi:

```text
public API package
internal package discipline
architecture test
module dependency rule
DTO boundary
anti-corruption layer antar domain
```

---

## 22. Refactoring Path

### 22.1 Dari Type Field ke Composite

Awal:

```java
class FormItem {
    String type;
    List<FormItem> children;
    String label;
    String fieldType;
}
```

Masalah:

```text
semua field optional
validasi berdasarkan type string
illegal state mudah terjadi
```

Refactoring:

1. Identifikasi type valid.
2. Buat sealed interface.
3. Buat subtype per konsep domain.
4. Pindahkan invariant ke constructor subtype.
5. Buat mapper dari legacy model ke model baru.
6. Tambahkan traversal utility.
7. Ganti service logic bertahap.
8. Tambahkan characterization test.

Hasil:

```java
sealed interface FormNode permits FormSection, FormField { }
record FormSection(..., List<FormNode> children) implements FormNode { }
record FormField(..., FieldType type) implements FormNode { }
```

---

### 22.2 Dari Class Explosion ke Bridge

Awal:

```text
PdfEmailReport
PdfSftpReport
ExcelEmailReport
ExcelSftpReport
HtmlEmailReport
HtmlSftpReport
```

Refactoring:

1. Petakan axis variasi.
2. Pisahkan rendering dari delivery.
3. Buat abstraction `ReportRenderer`.
4. Buat implementor `DeliveryTarget`.
5. Migrasi satu kombinasi dulu.
6. Buat factory/composition root.
7. Hapus class kombinatorial.

Hasil:

```text
PdfRenderer + EmailTarget
PdfRenderer + SftpTarget
ExcelRenderer + EmailTarget
ExcelRenderer + SftpTarget
```

---

### 22.3 Dari Memory Bloat ke Flyweight

Langkah:

1. Profiling heap.
2. Identifikasi repeated state.
3. Pisahkan intrinsic/extrinsic state.
4. Pastikan intrinsic state immutable.
5. Buat registry/interning factory.
6. Tambahkan metric registry size/hit ratio.
7. Load test.
8. Pastikan no unbounded key cardinality.

---

### 22.4 Dari Fake Modularity ke Boundary Nyata

Langkah:

1. Generate dependency graph package/module.
2. Tandai dependency ilegal.
3. Definisikan public API per module.
4. Pindahkan internal class dari public usage.
5. Buat facade/application service.
6. Ganti direct repository access dengan API call.
7. Pecah `common` menjadi owned concept.
8. Tambahkan architecture test.
9. Review build/module dependency.

---

## 23. Testing Strategy

### 23.1 Composite Testing

Test yang penting:

1. Leaf behavior.
2. Composite behavior.
3. Recursive traversal.
4. Empty children.
5. Deep tree.
6. Cycle detection.
7. Mutation protection.
8. Serialization/deserialization.
9. Persistence reconstruction.
10. Access control per subtree.

Contoh:

```java
@Test
void sectionShouldDefensivelyCopyChildren() {
    List<CaseNode> children = new ArrayList<>();
    children.add(new FindingNode(...));

    SectionNode section = new SectionNode(..., children);
    children.clear();

    assertEquals(1, section.children().size());
}
```

---

### 23.2 Bridge Testing

Test yang penting:

1. Abstraction compose message/document dengan benar.
2. Implementor melakukan delivery/write dengan benar.
3. Kombinasi abstraction + implementor bekerja.
4. Failure dari implementor diterjemahkan dengan benar.
5. Side effect tidak tersembunyi.

Gunakan contract test untuk implementor:

```java
interface DeliveryChannelContract {
    DeliveryChannel channel();

    @Test
    default void shouldReturnReceiptWhenDeliverySucceeds() {
        DeliveryReceipt receipt = channel().deliver(sampleMessage());
        assertTrue(receipt.successful());
    }
}
```

---

### 23.3 Flyweight Testing

Test yang penting:

1. Equal intrinsic state menghasilkan shared instance.
2. Different intrinsic state menghasilkan different instance.
3. Shared object immutable.
4. Registry size bounded sesuai expectation.
5. Concurrent access aman.

Contoh:

```java
@Test
void shouldInternEqualStyles() {
    CellStyleRegistry registry = new CellStyleRegistry();

    CellStyle a = registry.intern(new CellStyle("Arial", 12, "BLACK", "LEFT", "THIN"));
    CellStyle b = registry.intern(new CellStyle("Arial", 12, "BLACK", "LEFT", "THIN"));

    assertSame(a, b);
}
```

---

### 23.4 Module Boundary Testing

Gunakan architecture test.

Pseudo-rule:

```java
noClasses()
    .that().resideOutsideOfPackage("..casehandling..")
    .should().accessClassesThat().resideInAnyPackage(
        "..casehandling.domain..",
        "..casehandling.infrastructure..",
        "..casehandling.internal.."
    );
```

Tujuannya bukan gaya-gayaan. Tujuannya menjaga dependency graph tetap sesuai desain.

---

## 24. Observability dan Debugging Angle

### 24.1 Composite Observability

Untuk tree operation, log harus mencakup:

```text
root id
node count
max depth
operation name
failed node id
failed node type
path dari root ke node gagal
```

Contoh structured log:

```text
operation=validate_case_tree
caseId=CASE-2026-001
rootNodeId=N-ROOT
nodeCount=84
maxDepth=5
failedNodeId=N-45
failedPath=/root/section-2/finding-7
error=missing_required_evidence
```

---

### 24.2 Bridge Observability

Bridge perlu memperjelas dua axis:

```text
abstraction type
implementation type
operation
latency
failure category
```

Contoh:

```text
operation=send_notification
notificationType=CaseAssignedNotification
deliveryChannel=EmailDeliveryChannel
recipientType=OFFICER
latencyMs=380
result=SUCCESS
```

---

### 24.3 Flyweight Observability

Metric penting:

```text
registry.size
registry.hit.count
registry.miss.count
registry.eviction.count
estimated.memory.saved
```

Jika registry size terus naik tanpa batas, itu early warning memory leak.

---

### 24.4 Module Boundary Observability

Boundary observability lebih konseptual:

```text
module dependency graph
cycle count
illegal dependency count
API usage count
internal package access violation
```

Top engineer sering memperlakukan dependency graph sebagai production artifact, bukan hanya dokumentasi.

---

## 25. Performance Consideration

### 25.1 Composite

Risiko performance:

1. Recursive traversal berulang.
2. N+1 query saat lazy children.
3. Deep recursion stack overflow.
4. Full tree loading padahal butuh partial.
5. Expensive aggregate calculation tanpa cache.

Mitigasi:

```text
batch load tree
materialized path untuk query tertentu
closure table untuk hierarchy kompleks
cache aggregate jika read-heavy
iterative traversal untuk depth besar
limit depth dan node count
```

---

### 25.2 Bridge

Risiko performance:

1. Extra indirection biasanya kecil.
2. Implementor bisa menyembunyikan remote call mahal.
3. Composition root bisa membuat object terlalu sering.

Mitigasi:

```text
observability per implementor
clear timeout
reuse stateless implementor
avoid bridge untuk hot path ultra sederhana tanpa force
```

---

### 25.3 Flyweight

Risiko performance:

1. Registry lookup overhead.
2. Hash calculation mahal.
3. Contention di concurrent map.
4. Cache memory leak.
5. GC pressure dari key object sementara.

Mitigasi:

```text
ukur dengan benchmark/profiling
pastikan key ringan
gunakan bounded cache jika cardinality tinggi
hindari flyweight untuk object short-lived kecil tanpa memory issue
```

---

### 25.4 Module Boundary

Risiko performance module boundary biasanya bukan CPU, tetapi organizational/runtime complexity:

1. Terlalu banyak module membuat build lambat.
2. Terlalu banyak DTO mapping.
3. Terlalu banyak boundary call internal.
4. Over-isolation membuat perubahan kecil menyentuh banyak package.

Mitigasi:

```text
pisahkan boundary berdasarkan volatility dan ownership
jangan membuat remote boundary hanya karena package boundary
pakai internal direct call jika masih dalam module yang sama
ukur cognitive cost
```

---

## 26. Design Review Checklist

### 26.1 Composite Checklist

Gunakan pertanyaan ini:

```text
Apakah domain benar-benar tree?
Apakah cycle mungkin terjadi?
Apakah max depth perlu dibatasi?
Apakah children immutable dari luar?
Apakah leaf dan composite punya interface yang jujur?
Apakah traversal tersebar atau terpusat?
Apakah recursive operation punya error path yang jelas?
Apakah partial load dibedakan dari empty children?
Apakah persistence model mendukung struktur ini?
Apakah audit perubahan tree lengkap?
```

---

### 26.2 Bridge Checklist

```text
Apa dua axis variasi yang dipisahkan?
Apakah keduanya benar-benar berubah independen?
Apakah tanpa Bridge class akan meledak kombinatorial?
Apakah abstraction punya semantic value?
Apakah implementor menyembunyikan side effect mahal?
Apakah composition root jelas?
Apakah testing tiap axis mudah?
Apakah interface terlalu generik?
```

---

### 26.3 Flyweight Checklist

```text
Apakah memory pressure terbukti?
Berapa jumlah object?
State mana intrinsic?
State mana extrinsic?
Apakah intrinsic state immutable?
Apakah equality/hashCode benar?
Apakah registry bounded?
Apakah ada metric registry size?
Apakah concurrency aman?
Apakah complexity sepadan dengan memory saving?
```

---

### 26.4 Module Boundary Checklist

```text
Apa public API module ini?
Apa yang internal?
Apakah module lain memakai repository/entity internal?
Apakah dependency direction benar?
Apakah ada cyclic dependency?
Apakah common module menjadi dumping ground?
Apakah boundary enforceable lewat test/build?
Apakah DTO/API model stabil?
Apakah module owner jelas?
Apakah perubahan di module ini menyebar terlalu jauh?
```

---

## 27. Senior-Level Discussion

### 27.1 Kenapa Composite Bisa Berbahaya?

Composite berbahaya ketika kamu memaksakan semua node punya operasi yang sama padahal domain tidak demikian. Ini menciptakan interface yang bohong, `UnsupportedOperationException`, dan illegal state.

Composite juga berbahaya ketika mutation tidak dikontrol. Tree bukan hanya data structure; dalam enterprise domain, tree sering membawa authority, audit, workflow, dan persistence implication.

---

### 27.2 Kenapa Bridge Sering Jarang Disebut Tapi Banyak Dipakai?

Banyak engineer memakai Bridge tanpa menyebutnya Bridge. Setiap kali ada abstraction yang stabil dan implementation yang bisa diganti secara independen, Bridge-like structure muncul.

Contoh:

```text
JDBC API vs database driver
SLF4J API vs logging backend
Notification abstraction vs channel implementation
Storage abstraction vs S3/local/minio implementation
```

Yang penting bukan nama pattern, tetapi kemampuan membaca axis perubahan.

---

### 27.3 Kenapa Flyweight Jarang Dipakai di Business Code?

Karena kebanyakan business application tidak memiliki object count cukup besar untuk membayar kompleksitas Flyweight. JVM modern juga sangat efisien untuk banyak object kecil short-lived.

Flyweight menjadi penting pada engine-like component:

```text
renderer
parser
compiler-like processor
large export generator
rule evaluation engine
permission matrix
high-volume metadata model
```

---

### 27.4 Kenapa Module Boundary Lebih Penting dari Pattern Kecil?

Karena module boundary menentukan arah perubahan. Pattern di dalam class bisa bersih, tetapi jika module dependency kacau, sistem tetap sulit berkembang.

Top 1% engineer tidak hanya merapikan class. Mereka merapikan **dependency topology**.

---

## 28. Decision Matrix

| Problem | Pattern yang Mungkin | Jangan Gunakan Jika |
|---|---|---|
| Struktur recursive/tree | Composite | Data hanya association biasa |
| Banyak operasi terhadap closed node hierarchy | Visitor / pattern matching switch | Node type sering berubah |
| Dua axis variasi menyebabkan class explosion | Bridge | Hanya ada satu axis variasi |
| Banyak object memiliki repeated immutable state | Flyweight | Memory pressure belum terbukti |
| Folder rapi tapi dependency bocor | Module Boundary | Boundary tidak punya ownership/force |
| External model merembes ke domain | Adapter / ACL | Masalahnya bukan integrasi |
| Cross-cutting behavior runtime | Decorator / Proxy / Interceptor | Ordering dan visibility tidak bisa dijaga |

---

## 29. Common Mistakes

### Mistake 1 — Menggunakan Composite untuk Semua Hierarchy

Tidak semua parent-child adalah Composite.

```text
Order punya OrderLine bukan Composite jika OrderLine tidak diperlakukan sebagai OrderComponent.
```

### Mistake 2 — Menganggap Sealed Class Selalu Lebih Baik

Sealed class cocok untuk closed hierarchy. Jika extension oleh plugin/module lain adalah requirement, sealed class bisa menjadi hambatan.

### Mistake 3 — Membuat Bridge Karena Ingin “Clean”

Bridge harus menjawab class explosion atau independent evolution. Jika tidak, itu hanya indirection.

### Mistake 4 — Flyweight Tanpa Profiling

Flyweight adalah optimization pattern. Optimization tanpa measurement sering menjadi complexity bug.

### Mistake 5 — Module Boundary Tanpa Enforcement

Boundary yang hanya tertulis di README akan dilanggar saat deadline.

---

## 30. Practical Java Guidelines

### 30.1 Untuk Composite

```text
Gunakan sealed interface jika hierarchy closed.
Gunakan record untuk immutable node jika cocok.
Defensive copy semua collection.
Pisahkan loaded-empty dari not-loaded jika perlu.
Jangan expose mutable children.
Tambahkan cycle detection untuk operasi write/move/import.
Buat traversal utility jika operasi traversal banyak.
```

---

### 30.2 Untuk Bridge

```text
Mulai dari concrete code dulu.
Extract Bridge saat dua axis variasi terbukti.
Beri nama abstraction dan implementor berdasarkan domain.
Jangan buat interface tanpa semantic force.
Pastikan side effect implementor terlihat dari API contract.
```

---

### 30.3 Untuk Flyweight

```text
Profiling dulu.
Pisahkan intrinsic/extrinsic state secara eksplisit.
Pastikan shared state immutable.
Gunakan record/value object untuk key.
Monitor registry size.
Beri batas jika cardinality tidak natural.
```

---

### 30.4 Untuk Module Boundary

```text
Buat API package kecil dan stabil.
Jangan expose entity internal.
Jaga dependency direction.
Hindari common module sebagai tempat sampah.
Gunakan architecture test.
Review dependency graph secara berkala.
```

---

## 31. Latihan Praktis

### Latihan 1 — Composite

Ambil domain berikut:

```text
PolicyDocument
- Chapter
- Section
- Clause
- AttachmentReference
```

Tugas:

1. Buat sealed interface `PolicyNode`.
2. Tentukan leaf dan composite.
3. Buat traversal untuk menghitung jumlah clause.
4. Tambahkan validation max depth 5.
5. Tambahkan cycle detection berdasarkan node id.

---

### Latihan 2 — Bridge

Domain:

```text
Report type: CaseSummary, AuditTrail, RevenueReport
Output format: PDF, Excel, CSV
Delivery target: Download, Email, S3
```

Tugas:

1. Identifikasi axis yang benar.
2. Hindari class explosion.
3. Desain Bridge atau kombinasi Bridge + Strategy.
4. Jelaskan trade-off.

---

### Latihan 3 — Flyweight

Domain:

```text
Permission assignment untuk 1 juta user.
Banyak user memakai permission descriptor yang sama.
```

Tugas:

1. Pisahkan intrinsic dan extrinsic state.
2. Buat registry/interning factory.
3. Tambahkan metric registry size.
4. Jelaskan kapan registry bisa memory leak.

---

### Latihan 4 — Module Boundary

Domain:

```text
case module
application module
document module
notification module
```

Tugas:

1. Tentukan public API masing-masing module.
2. Tentukan dependency yang legal.
3. Tentukan dependency yang ilegal.
4. Buat pseudo architecture test.
5. Jelaskan risiko `common` module.

---

## 32. Ringkasan

Composite, Bridge, Flyweight, dan Module Boundary sama-sama structural pattern, tetapi bekerja pada level berbeda:

```text
Composite       -> bentuk object graph recursive
Bridge          -> bentuk class/abstraction hierarchy terhadap axis perubahan
Flyweight       -> bentuk memory/state sharing
Module Boundary -> bentuk dependency topology sistem
```

Composite membantu ketika domain benar-benar tree dan operasi recursive penting. Tetapi Composite bisa rusak jika mutation tidak dikontrol, cycle tidak dicegah, atau interface dipaksa terlalu seragam.

Bridge membantu ketika ada dua axis variasi yang tumbuh independen. Tetapi Bridge bisa menjadi abstraction explosion jika dipakai sebelum force-nya nyata.

Flyweight membantu menghemat memory ketika banyak object berbagi state immutable yang sama. Tetapi Flyweight harus didorong oleh measurement, bukan feeling.

Module Boundary adalah structural pattern paling penting untuk codebase enterprise jangka panjang. Tanpa boundary yang nyata, pattern level class hanya memperindah bagian kecil dari dependency graph yang tetap kacau.

Top engineer memahami bahwa desain bukan hanya tentang class yang rapi. Desain adalah tentang mengontrol bentuk pertumbuhan sistem.

---

## 33. Referensi Lanjut

Referensi berikut berguna untuk memperdalam konsep setelah memahami materi ini:

1. Refactoring.Guru — Structural Design Patterns.
2. Refactoring.Guru — Flyweight Pattern.
3. Oracle Java SE Specification — Java Language Specification dan Java SE 25 updates.
4. OpenJDK JEP 441 — Pattern Matching for switch.
5. Martin Fowler — Monolith First.
6. Martin Fowler — Linking Modular Architecture to Development Teams.
7. Refactoring.com — definisi refactoring sebagai restrukturisasi internal tanpa mengubah external behavior.
8. Literatur refactoring Composite dan Visitor pada Java codebase.

---

## 34. Status Seri

```text
Part 9 dari 35 selesai.
Seri belum selesai.
```

Bagian berikutnya:

```text
10-behavioral-strategy-policy-specification-rule-object.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./08-structural-decorator-proxy-interceptor-middleware-chain.md">⬅️ Part 8 — Structural Pattern II: Decorator, Proxy, Interceptor, Middleware Chain</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./10-behavioral-strategy-policy-specification-rule-object.md">Part 10 — Behavioral Pattern I: Strategy, Policy, Specification, Rule Object ➡️</a>
</div>
