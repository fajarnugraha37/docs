# 11 — Behavioral Pattern II: Command, Handler, Chain of Responsibility

> Seri: `learn-java-design-patterns-antipatterns-architecture-engineering`  
> Bagian: `11 dari 35`  
> File: `11-behavioral-command-handler-chain-of-responsibility.md`  
> Scope Java: Java 8 sampai Java 25  
> Fokus: Command, Command Handler, Command Bus, Chain of Responsibility, pipeline, idempotency, ordering, failure semantics, dan anti-pattern di Java enterprise systems.

---

## 0. Peta Besar

Pada bagian sebelumnya, kita membahas **Strategy, Policy, Specification, dan Rule Object**. Pola-pola itu berfokus pada pertanyaan:

> “Bagaimana sebuah keputusan dihitung?”

Bagian ini berpindah ke pertanyaan berikutnya:

> “Bagaimana sebuah niat perubahan sistem direpresentasikan, divalidasi, dieksekusi, diaudit, dan dikontrol?”

Di banyak codebase Java enterprise, operasi bisnis biasanya muncul sebagai method service seperti ini:

```java
caseService.approve(caseId, officerId, remarks);
caseService.reject(caseId, officerId, reasonCode, remarks);
caseService.assign(caseId, assigneeId);
caseService.escalate(caseId, escalationLevel, remarks);
```

Pada awalnya ini terlihat sederhana. Tetapi ketika sistem membesar, method tersebut mulai menyerap terlalu banyak tanggung jawab:

- mengambil data;
- validasi input;
- validasi permission;
- validasi state;
- menjalankan rule;
- membuka transaksi;
- memanggil external system;
- mengubah entity;
- menulis audit trail;
- mengirim event;
- membuat notification;
- menangani retry;
- menangani idempotency;
- menangani error mapping;
- menyusun response.

Akhirnya satu method menjadi “mini workflow engine” tanpa desain eksplisit.

Pattern Command, Handler, dan Chain of Responsibility membantu memisahkan beberapa hal penting:

1. **Intent** — apa yang diminta user/system.
2. **Authorization** — siapa yang boleh melakukan intent itu.
3. **Validation** — apakah request valid secara syntactic dan semantic.
4. **Execution** — perubahan domain yang sah.
5. **Side effect** — audit, event, notification, integration.
6. **Failure semantics** — apa yang terjadi saat gagal.
7. **Idempotency** — apakah intent yang sama aman diulang.
8. **Observability** — bagaimana operasi ini ditelusuri.

Jika Strategy dan Specification membantu kita memodelkan “keputusan”, Command membantu kita memodelkan “aksi”.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan materi ini, kamu diharapkan mampu:

1. Membedakan Command sebagai **intent object** dari DTO biasa.
2. Mendesain Command yang membawa makna bisnis, bukan sekadar parameter bag.
3. Memahami kapan Command pattern berguna dan kapan overengineering.
4. Membedakan Command, Query, Event, Request, DTO, dan Message.
5. Mendesain Command Handler sebagai boundary eksekusi use case.
6. Memahami Command Bus dan risiko abstraksi berlebihan.
7. Menggunakan Chain of Responsibility untuk pipeline validasi, otorisasi, enrichment, dan processing.
8. Mendesain handler ordering secara eksplisit dan defensible.
9. Menangani short-circuiting dengan benar.
10. Mendesain error propagation dalam chain.
11. Menambahkan idempotency ke command handling.
12. Menyusun retry semantics yang tidak merusak domain.
13. Membedakan synchronous command dari asynchronous command.
14. Menghindari anti-pattern seperti god handler, handler explosion, command as anemic wrapper, dan chain dengan hidden side effect.
15. Menggunakan Java 8–25 features untuk memperjelas desain command/handler.
16. Membangun mental model top engineer untuk operation modeling.

---

## 2. Masalah Nyata yang Ingin Diselesaikan

Bayangkan sistem regulatory case management. Ada operasi:

```text
Approve Case
Reject Case
Request Clarification
Assign Officer
Escalate Case
Close Case
Reopen Case
Generate Notice
Send Reminder
```

Setiap operasi punya aturan berbeda:

- user role berbeda;
- allowed state berbeda;
- mandatory field berbeda;
- audit wording berbeda;
- notification berbeda;
- external integration berbeda;
- legal consequence berbeda;
- rollback semantics berbeda;
- retry safety berbeda.

Pendekatan naif biasanya seperti ini:

```java
@Transactional
public ApprovalResponse approveCase(String caseId, String officerId, String remarks) {
    Case c = caseRepository.findById(caseId)
            .orElseThrow(() -> new NotFoundException("Case not found"));

    User officer = userRepository.findById(officerId)
            .orElseThrow(() -> new NotFoundException("Officer not found"));

    if (!officer.hasRole("SENIOR_OFFICER")) {
        throw new ForbiddenException("Not allowed");
    }

    if (!c.status().equals("PENDING_APPROVAL")) {
        throw new IllegalStateException("Cannot approve case");
    }

    if (remarks == null || remarks.isBlank()) {
        throw new BadRequestException("Remarks required");
    }

    c.approve(officerId, remarks);
    caseRepository.save(c);

    auditService.log("Case approved " + caseId + " by " + officerId);
    notificationService.notifyApplicant(c.applicantId(), "Approved");
    eventPublisher.publish(new CaseApprovedEvent(caseId));

    return new ApprovalResponse(caseId, c.status());
}
```

Masalahnya bukan karena method ini “panjang”. Masalahnya adalah **semua concern bercampur tanpa boundary konseptual**.

Ketika requirement berubah:

- “Approval harus idempotent kalau user double-click.”
- “Audit harus tetap tercatat walau notification gagal.”
- “Permission rule berubah berdasarkan agency.”
- “Approval dari queue worker harus memakai system actor.”
- “Approval harus dicegah jika ada outstanding enforcement action.”
- “Approval harus publish event setelah commit.”
- “Approval harus support dry-run validation.”
- “Approval harus punya correlation id.”
- “Approval harus punya reason codes untuk UI.”

Method service tadi akan makin sulit dikontrol.

Command + Handler + Chain membantu mengubah operasi menjadi struktur eksplisit:

```text
ApproveCaseCommand
    -> Command Metadata
    -> Validation Chain
    -> Authorization Handler
    -> Idempotency Handler
    -> Transactional Use Case Handler
    -> Domain Operation
    -> Post-Commit Side Effects
```

Dengan model ini, operasi tidak lagi hanya “method call”. Operasi menjadi **unit of intent** yang bisa ditelusuri, divalidasi, diretry, diaudit, dan dikontrol.

---

## 3. Mental Model Utama

### 3.1 Command adalah Niat, Bukan Sekadar Data

Command merepresentasikan niat melakukan sesuatu:

```text
Approve this case.
Assign this officer.
Generate this notice.
Escalate this violation.
```

Command berbeda dari DTO karena command punya makna aksi.

DTO biasa:

```java
public record ApprovalRequest(
        String caseId,
        String remarks
) {}
```

Command:

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId approvedBy,
        String remarks,
        CommandMetadata metadata
) {}
```

Perbedaannya bukan hanya nama. Perbedaannya ada pada **semantik**.

`ApprovalRequest` berarti:

> “Data yang datang dari HTTP request.”

`ApproveCaseCommand` berarti:

> “Intent internal sistem untuk melakukan approval terhadap case tertentu oleh actor tertentu dengan metadata tertentu.”

DTO adalah bentuk transport. Command adalah bentuk use case.

---

### 3.2 Handler adalah Pemilik Eksekusi Use Case

Command handler menjawab:

> “Bagaimana command ini dijalankan dengan benar?”

Contoh:

```java
public interface CommandHandler<C, R> {
    R handle(C command);
}
```

```java
public final class ApproveCaseHandler
        implements CommandHandler<ApproveCaseCommand, ApproveCaseResult> {

    private final CaseRepository caseRepository;
    private final ApprovalPolicy approvalPolicy;
    private final AuditRecorder auditRecorder;

    public ApproveCaseHandler(
            CaseRepository caseRepository,
            ApprovalPolicy approvalPolicy,
            AuditRecorder auditRecorder
    ) {
        this.caseRepository = caseRepository;
        this.approvalPolicy = approvalPolicy;
        this.auditRecorder = auditRecorder;
    }

    @Override
    public ApproveCaseResult handle(ApproveCaseCommand command) {
        CaseAggregate caseAggregate = caseRepository.getRequired(command.caseId());

        ApprovalDecision decision = approvalPolicy.evaluate(caseAggregate, command.approvedBy());
        if (!decision.allowed()) {
            throw new CommandRejectedException(decision.reasons());
        }

        caseAggregate.approve(command.approvedBy(), command.remarks());
        caseRepository.save(caseAggregate);

        auditRecorder.recordApproval(caseAggregate, command.metadata());

        return new ApproveCaseResult(caseAggregate.id(), caseAggregate.status());
    }
}
```

Handler bukan sekadar tempat menaruh logic. Handler adalah **application boundary** untuk satu use case.

---

### 3.3 Chain of Responsibility adalah Pipeline Keputusan Eksekusi

Tidak semua concern harus ada di handler utama.

Kita bisa membuat chain:

```text
Receive command
  -> validate command shape
  -> authenticate actor
  -> authorize operation
  -> enforce idempotency
  -> open transaction
  -> execute handler
  -> publish post-commit event
  -> map result
```

Chain of Responsibility cocok jika:

- ada serangkaian langkah yang bisa disusun;
- sebagian langkah bisa menghentikan proses;
- urutan penting;
- concern sebaiknya dipisah;
- langkah-langkah bisa reuse di banyak command;
- pipeline perlu terlihat sebagai struktur desain.

---

## 4. Command Pattern: Definisi dan Intent

Dalam pola klasik, Command merangkum request sebagai object sehingga request bisa:

- diparameterisasi;
- diantrikan;
- dicatat;
- dibatalkan;
- diulang;
- dikirim ke handler berbeda.

Dalam enterprise Java modern, Command biasanya dipakai untuk:

1. Use case boundary.
2. CQRS command side.
3. API-to-application translation.
4. Queue message processing.
5. Audit-friendly action modeling.
6. Idempotent operation modeling.
7. Workflow transition modeling.
8. Retryable job modeling.

Command menjadikan aksi sebagai data yang eksplisit.

Tanpa Command:

```java
approvalService.approve(caseId, officerId, remarks);
```

Dengan Command:

```java
commandBus.dispatch(new ApproveCaseCommand(
        new CaseId(caseId),
        new OfficerId(officerId),
        remarks,
        metadata
));
```

Perubahan ini menambahkan struktur. Tetapi struktur itu hanya bernilai jika command memang butuh diproses sebagai unit intent.

---

## 5. Command vs DTO vs Query vs Event vs Message

Ini area yang sering membingungkan.

### 5.1 DTO

DTO adalah bentuk data untuk berpindah boundary.

```java
public record ApproveCaseRequest(
        String remarks
) {}
```

Biasanya milik adapter layer, misalnya REST controller.

DTO tidak harus punya makna domain mendalam.

---

### 5.2 Command

Command adalah niat untuk mengubah state.

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId actorId,
        String remarks,
        CommandMetadata metadata
) {}
```

Command biasanya milik application layer.

Command harus membawa data yang cukup untuk menjalankan use case, tetapi tidak harus membawa seluruh aggregate.

---

### 5.3 Query

Query adalah niat membaca state tanpa mutation.

```java
public record GetCaseDetailsQuery(
        CaseId caseId,
        ViewerId viewerId
) {}
```

Command mengubah state. Query membaca state.

Memisahkan command dan query membantu clarity:

```text
Command -> mutation -> transaction -> audit/event
Query   -> read      -> projection -> caching/pagination
```

---

### 5.4 Event

Event adalah fakta bahwa sesuatu sudah terjadi.

```java
public record CaseApprovedEvent(
        CaseId caseId,
        OfficerId approvedBy,
        Instant approvedAt
) {}
```

Command bersifat imperatif:

```text
Approve this case.
```

Event bersifat historis:

```text
This case was approved.
```

Command bisa ditolak. Event tidak boleh “ditolak” karena event adalah fakta masa lalu.

---

### 5.5 Message

Message adalah bentuk transport.

Message bisa membawa command, event, query, atau notification.

```text
Kafka record      -> message envelope
RabbitMQ message  -> message envelope
HTTP request      -> message envelope
```

Jangan menyamakan message dengan command. Message adalah kendaraan; command adalah muatan semantik.

---

## 6. Anatomi Command yang Baik

Command yang baik biasanya memiliki:

1. **Nama aksi yang eksplisit**
2. **Target yang jelas**
3. **Actor yang jelas**
4. **Input yang diperlukan**
5. **Metadata operasi**
6. **Idempotency key jika relevan**
7. **Correlation/causation id jika relevan**
8. **Tidak membawa object graph besar**
9. **Tidak membawa entity mutable**
10. **Tidak membawa detail transport mentah**

Contoh:

```java
public record CommandMetadata(
        String correlationId,
        String causationId,
        String requestId,
        String idempotencyKey,
        Instant requestedAt,
        String source,
        String actorType
) {}
```

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId actorId,
        String remarks,
        CommandMetadata metadata
) {
    public ApproveCaseCommand {
        Objects.requireNonNull(caseId, "caseId must not be null");
        Objects.requireNonNull(actorId, "actorId must not be null");
        Objects.requireNonNull(metadata, "metadata must not be null");
        if (remarks == null || remarks.isBlank()) {
            throw new IllegalArgumentException("remarks must not be blank");
        }
    }
}
```

Dengan Java records, command menjadi ringkas dan immutable.

Tetapi hati-hati: record bukan otomatis domain-safe. Jika field masih `String caseId`, `String actorId`, `String status`, kamu tetap bisa mengalami primitive obsession.

Lebih baik:

```java
public record CaseId(String value) {
    public CaseId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("case id must not be blank");
        }
    }
}
```

---

## 7. Command sebagai Boundary Use Case

Command biasanya dibuat di adapter layer lalu dikirim ke application layer.

```java
@RestController
public final class CaseApprovalController {

    private final CommandBus commandBus;
    private final CurrentUser currentUser;

    public CaseApprovalController(CommandBus commandBus, CurrentUser currentUser) {
        this.commandBus = commandBus;
        this.currentUser = currentUser;
    }

    @PostMapping("/cases/{caseId}/approve")
    public ResponseEntity<ApproveCaseResponse> approve(
            @PathVariable String caseId,
            @RequestBody ApproveCaseRequest request,
            HttpServletRequest servletRequest
    ) {
        CommandMetadata metadata = CommandMetadataFactory.from(servletRequest);

        ApproveCaseCommand command = new ApproveCaseCommand(
                new CaseId(caseId),
                new OfficerId(currentUser.id()),
                request.remarks(),
                metadata
        );

        ApproveCaseResult result = commandBus.dispatch(command);

        return ResponseEntity.ok(new ApproveCaseResponse(
                result.caseId().value(),
                result.status().name()
        ));
    }
}
```

Controller tidak memutuskan approval rule. Controller hanya melakukan:

- transport parsing;
- authentication context reading;
- DTO to command mapping;
- dispatch;
- result to response mapping.

Application layer menerima command yang sudah bebas dari detail HTTP.

Ini menjaga boundary.

---

## 8. Command Handler Pattern

Command handler adalah class yang mengeksekusi satu command type.

Interface umum:

```java
public interface CommandHandler<C, R> {
    R handle(C command);
}
```

Atau dengan marker interface:

```java
public interface Command<R> {}

public interface CommandHandler<C extends Command<R>, R> {
    R handle(C command);
}
```

Contoh:

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId actorId,
        String remarks,
        CommandMetadata metadata
) implements Command<ApproveCaseResult> {}
```

```java
public final class ApproveCaseHandler
        implements CommandHandler<ApproveCaseCommand, ApproveCaseResult> {

    private final CaseRepository caseRepository;
    private final PermissionService permissionService;
    private final CaseApprovalPolicy approvalPolicy;
    private final DomainEventCollector eventCollector;

    public ApproveCaseHandler(
            CaseRepository caseRepository,
            PermissionService permissionService,
            CaseApprovalPolicy approvalPolicy,
            DomainEventCollector eventCollector
    ) {
        this.caseRepository = caseRepository;
        this.permissionService = permissionService;
        this.approvalPolicy = approvalPolicy;
        this.eventCollector = eventCollector;
    }

    @Override
    public ApproveCaseResult handle(ApproveCaseCommand command) {
        CaseAggregate caseAggregate = caseRepository.getRequired(command.caseId());

        permissionService.requirePermission(
                command.actorId(),
                Permission.APPROVE_CASE,
                caseAggregate.id()
        );

        ApprovalDecision decision = approvalPolicy.evaluate(caseAggregate, command.actorId());
        if (!decision.allowed()) {
            throw new CommandRejectedException(decision.reasons());
        }

        caseAggregate.approve(command.actorId(), command.remarks());

        caseRepository.save(caseAggregate);
        eventCollector.collect(caseAggregate.pullDomainEvents());

        return new ApproveCaseResult(caseAggregate.id(), caseAggregate.status());
    }
}
```

Handler sebaiknya bukan tempat semua detail teknis menumpuk. Handler adalah orchestrator use case yang memanggil domain object, policy, repository, dan side-effect boundary dengan jelas.

---

## 9. Handler Bukan Domain Model

Kesalahan umum:

```java
public final class ApproveCaseHandler {
    public void handle(ApproveCaseCommand command) {
        CaseEntity entity = repository.find(...);

        if (!entity.getStatus().equals("PENDING")) {
            throw ...;
        }

        entity.setStatus("APPROVED");
        entity.setApprovedBy(command.actorId());
        entity.setApprovedAt(Instant.now());
    }
}
```

Ini membuat handler mengambil alih domain behavior.

Lebih baik:

```java
caseAggregate.approve(command.actorId(), command.remarks(), clock.instant());
```

Domain object menjaga invariant:

```java
public final class CaseAggregate {

    public void approve(OfficerId actorId, String remarks, Instant approvedAt) {
        if (status != CaseStatus.PENDING_APPROVAL) {
            throw new IllegalTransitionException(status, CaseStatus.APPROVED);
        }

        if (remarks == null || remarks.isBlank()) {
            throw new DomainInvariantViolation("Approval remarks required");
        }

        this.status = CaseStatus.APPROVED;
        this.approvedBy = actorId;
        this.approvedAt = approvedAt;
        this.domainEvents.add(new CaseApproved(id, actorId, approvedAt));
    }
}
```

Handler mengatur use case. Domain menjaga business invariant.

---

## 10. Command Bus

Command Bus adalah dispatcher yang menghubungkan command ke handler.

Tanpa command bus:

```java
approveCaseHandler.handle(command);
```

Dengan command bus:

```java
commandBus.dispatch(command);
```

Interface:

```java
public interface CommandBus {
    <R> R dispatch(Command<R> command);
}
```

Implementasi sederhana:

```java
public final class SimpleCommandBus implements CommandBus {

    private final Map<Class<?>, CommandHandler<?, ?>> handlers;

    public SimpleCommandBus(Map<Class<?>, CommandHandler<?, ?>> handlers) {
        this.handlers = Map.copyOf(handlers);
    }

    @Override
    @SuppressWarnings("unchecked")
    public <R> R dispatch(Command<R> command) {
        CommandHandler<Command<R>, R> handler =
                (CommandHandler<Command<R>, R>) handlers.get(command.getClass());

        if (handler == null) {
            throw new NoCommandHandlerException(command.getClass());
        }

        return handler.handle(command);
    }
}
```

Command Bus berguna jika kamu butuh:

- centralized middleware;
- logging all commands;
- permission middleware;
- metrics per command type;
- idempotency handling;
- transaction middleware;
- async dispatch abstraction;
- testing use case dispatch;
- CQRS style architecture.

Tetapi command bus bisa menjadi overengineering jika sistem hanya punya sedikit use case sederhana.

---

## 11. Command Bus Minimal vs Framework-heavy

Command Bus minimal:

```java
ApproveCaseResult result = approveCaseHandler.handle(command);
```

Command Bus eksplisit:

```java
ApproveCaseResult result = commandBus.dispatch(command);
```

Framework-heavy Command Bus:

```java
@CommandHandler
@Transactional
@RequiresPermission("CASE_APPROVE")
@Idempotent
@AuditAction("CASE_APPROVED")
public ApproveCaseResult handle(ApproveCaseCommand command) { ... }
```

Framework-heavy terlihat rapi, tetapi bisa menyembunyikan terlalu banyak behavior.

Pertanyaan design review:

```text
Ketika dispatch dipanggil, apa saja yang sebenarnya terjadi?
Di mana transaksi dibuka?
Di mana authorization berjalan?
Di mana retry terjadi?
Di mana audit terjadi?
Apa yang terjadi kalau handler throw exception?
Apakah side effect terjadi sebelum atau setelah commit?
Apakah command idempotent?
```

Jika tim tidak bisa menjawab, command bus sudah menjadi magic box.

---

## 12. Chain of Responsibility Pattern

Chain of Responsibility memungkinkan request melewati rangkaian handler, di mana setiap handler dapat:

- memproses request;
- meneruskan ke handler berikutnya;
- menghentikan proses;
- mengubah context;
- menghasilkan result;
- melempar error.

Contoh konseptual:

```text
Command
  -> LoggingMiddleware
  -> ValidationMiddleware
  -> AuthorizationMiddleware
  -> IdempotencyMiddleware
  -> TransactionMiddleware
  -> ActualHandler
```

Setiap middleware bertanggung jawab pada satu concern.

Interface:

```java
public interface CommandMiddleware {
    <R> R invoke(Command<R> command, CommandInvocation<R> next);
}
```

```java
@FunctionalInterface
public interface CommandInvocation<R> {
    R proceed();
}
```

Sederhana, tetapi cukup fleksibel.

---

## 13. Implementasi Chain Command Middleware

```java
public final class MiddlewareCommandBus implements CommandBus {

    private final CommandBus terminalBus;
    private final List<CommandMiddleware> middlewares;

    public MiddlewareCommandBus(
            CommandBus terminalBus,
            List<CommandMiddleware> middlewares
    ) {
        this.terminalBus = terminalBus;
        this.middlewares = List.copyOf(middlewares);
    }

    @Override
    public <R> R dispatch(Command<R> command) {
        return invoke(command, 0);
    }

    private <R> R invoke(Command<R> command, int index) {
        if (index == middlewares.size()) {
            return terminalBus.dispatch(command);
        }

        CommandMiddleware middleware = middlewares.get(index);
        return middleware.invoke(command, () -> invoke(command, index + 1));
    }
}
```

Logging middleware:

```java
public final class LoggingMiddleware implements CommandMiddleware {

    private static final Logger log = LoggerFactory.getLogger(LoggingMiddleware.class);

    @Override
    public <R> R invoke(Command<R> command, CommandInvocation<R> next) {
        String commandName = command.getClass().getSimpleName();
        long startNanos = System.nanoTime();

        try {
            log.info("Command started: {}", commandName);
            R result = next.proceed();
            long durationMs = (System.nanoTime() - startNanos) / 1_000_000;
            log.info("Command completed: {} durationMs={}", commandName, durationMs);
            return result;
        } catch (RuntimeException ex) {
            long durationMs = (System.nanoTime() - startNanos) / 1_000_000;
            log.warn("Command failed: {} durationMs={} error={}",
                    commandName, durationMs, ex.toString());
            throw ex;
        }
    }
}
```

Validation middleware:

```java
public final class ValidationMiddleware implements CommandMiddleware {

    private final CommandValidatorRegistry validatorRegistry;

    public ValidationMiddleware(CommandValidatorRegistry validatorRegistry) {
        this.validatorRegistry = validatorRegistry;
    }

    @Override
    public <R> R invoke(Command<R> command, CommandInvocation<R> next) {
        ValidationResult result = validatorRegistry.validate(command);
        if (!result.valid()) {
            throw new CommandValidationException(result.errors());
        }
        return next.proceed();
    }
}
```

Authorization middleware:

```java
public final class AuthorizationMiddleware implements CommandMiddleware {

    private final CommandAuthorizationService authorizationService;

    public AuthorizationMiddleware(CommandAuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    @Override
    public <R> R invoke(Command<R> command, CommandInvocation<R> next) {
        authorizationService.requireAllowed(command);
        return next.proceed();
    }
}
```

Transaction middleware:

```java
public final class TransactionMiddleware implements CommandMiddleware {

    private final TransactionTemplate transactionTemplate;

    public TransactionMiddleware(TransactionTemplate transactionTemplate) {
        this.transactionTemplate = transactionTemplate;
    }

    @Override
    public <R> R invoke(Command<R> command, CommandInvocation<R> next) {
        return transactionTemplate.execute(status -> next.proceed());
    }
}
```

Dengan chain, concern teknis tidak mencemari handler utama.

Tetapi chain harus eksplisit. Jangan biarkan chain menjadi magic yang tidak bisa dipahami.

---

## 14. Ordering Problem

Urutan middleware sangat penting.

Contoh urutan yang masuk akal:

```text
1. Correlation context
2. Logging start
3. Basic validation
4. Authentication context check
5. Authorization
6. Idempotency reservation
7. Transaction
8. Handler execution
9. Outbox/event collection
10. Metrics result
```

Kenapa validation sebelum transaction?

Karena invalid request tidak perlu membuka transaksi.

Kenapa authorization sebelum transaction?

Biasanya permission failure tidak butuh mutation.

Kenapa idempotency sebelum handler?

Karena duplicate request sebaiknya dihentikan sebelum mutation.

Kenapa event publishing setelah commit?

Karena event eksternal tidak boleh menyatakan fakta yang belum committed.

Contoh urutan berbahaya:

```text
1. Transaction
2. Handler
3. Authorization
```

Ini salah karena mutation bisa terjadi sebelum permission dicek.

Contoh lain:

```text
1. Handler
2. Idempotency
```

Ini salah karena duplicate request sudah mengubah state sebelum dicegah.

---

## 15. Short-Circuiting

Dalam chain, handler bisa menghentikan proses.

Contoh idempotency middleware:

```java
public final class IdempotencyMiddleware implements CommandMiddleware {

    private final IdempotencyStore store;

    public IdempotencyMiddleware(IdempotencyStore store) {
        this.store = store;
    }

    @Override
    public <R> R invoke(Command<R> command, CommandInvocation<R> next) {
        if (!(command instanceof IdempotentCommand<R> idempotent)) {
            return next.proceed();
        }

        String key = idempotent.idempotencyKey();

        Optional<R> existing = store.findCompletedResult(key);
        if (existing.isPresent()) {
            return existing.get();
        }

        store.reserve(key);

        try {
            R result = next.proceed();
            store.complete(key, result);
            return result;
        } catch (RuntimeException ex) {
            store.fail(key, ex);
            throw ex;
        }
    }
}
```

Short-circuiting harus jelas.

Pertanyaan penting:

```text
Apakah short-circuit menghasilkan result valid?
Apakah audit tetap perlu dicatat?
Apakah metrics membedakan duplicate vs new execution?
Apakah user mendapat response yang sama?
Apakah duplicate in-progress ditolak, ditunggu, atau dikembalikan sebagai conflict?
```

---

## 16. Idempotent Command Handling

Idempotency berarti operasi yang sama bisa dipanggil lebih dari sekali tanpa menghasilkan efek tambahan yang tidak diinginkan.

Contoh kasus:

- user double-click tombol approve;
- browser retry request setelah timeout;
- API gateway retry;
- queue redelivery;
- worker crash setelah commit tetapi sebelum ack;
- client tidak menerima response padahal server berhasil.

Command yang mutating sering perlu idempotency.

### 16.1 Natural Idempotency

Beberapa operasi naturally idempotent:

```text
Set case status to CLOSED if already CLOSED.
```

Tetapi approval biasanya tidak selalu naturally idempotent karena:

- audit bisa double;
- notification bisa double;
- event bisa double;
- timestamp bisa berubah;
- version bisa naik;
- side effect bisa berulang.

---

### 16.2 Idempotency Key

Command bisa membawa idempotency key:

```java
public interface IdempotentCommand<R> extends Command<R> {
    String idempotencyKey();
}
```

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId actorId,
        String remarks,
        CommandMetadata metadata
) implements IdempotentCommand<ApproveCaseResult> {

    @Override
    public String idempotencyKey() {
        return metadata.idempotencyKey();
    }
}
```

Idempotency store menyimpan:

```text
key
command_type
command_hash
status: IN_PROGRESS / COMPLETED / FAILED
result_snapshot
created_at
expires_at
```

Command hash penting untuk mencegah key yang sama dipakai untuk payload berbeda.

---

### 16.3 Idempotency Result Policy

Jika duplicate masuk:

```text
COMPLETED + same hash -> return previous result
COMPLETED + different hash -> reject conflict
IN_PROGRESS -> return 409 / wait / retry later
FAILED retryable -> allow retry or return previous failure
FAILED non-retryable -> return previous failure
```

Keputusan ini harus eksplisit.

---

## 17. Retryable Command

Retry bukan sekadar “coba lagi”. Retry harus memahami domain.

Command retry aman jika:

- operation idempotent;
- external side effect idempotent;
- duplicate event dicegah;
- transaction boundary jelas;
- partial failure bisa dikenali;
- command memiliki stable identity.

Contoh retry berbahaya:

```java
for (int i = 0; i < 3; i++) {
    try {
        approveCase(command);
        break;
    } catch (Exception ex) {
        // retry everything
    }
}
```

Jika approval berhasil di DB tetapi notification gagal, retry seluruh command bisa membuat audit/event duplicate.

Lebih baik:

```text
Command mutation committed once.
Post-commit side effects diproses via outbox.
Outbox event retry independently.
```

Command handler sebaiknya tidak melakukan external side effect irreversible di dalam transaksi domain.

---

## 18. Command dan Transaction Boundary

Command handler biasanya menjadi natural transaction boundary.

```java
@Transactional
public ApproveCaseResult handle(ApproveCaseCommand command) {
    ...
}
```

Tetapi hati-hati dengan annotation magic.

Pertanyaan:

```text
Apakah @Transactional aktif jika method dipanggil dari class yang sama?
Apakah handler diproxy oleh container?
Apakah event publish terjadi sebelum commit?
Apakah lazy loading dipakai setelah transaction selesai?
Apakah retry mengulang seluruh transaksi?
```

Dalam desain explicit middleware, transaction bisa terlihat lebih jelas:

```java
public final class TransactionMiddleware implements CommandMiddleware {
    ...
}
```

Namun di Spring, `@Transactional` di handler tetap umum dan acceptable jika tim memahami proxy semantics.

---

## 19. Command dan Domain Event

Command menghasilkan perubahan. Perubahan bisa menghasilkan domain event.

```java
caseAggregate.approve(...);
List<DomainEvent> events = caseAggregate.pullDomainEvents();
```

Event jangan langsung dipublish ke broker sebelum commit.

Lebih aman:

```text
1. Command handler mutate aggregate.
2. Aggregate emits domain event internally.
3. Handler saves aggregate.
4. Handler saves outbox records in same transaction.
5. Transaction commits.
6. Outbox publisher publishes to broker.
```

Ini menghindari dual-write problem.

Command Handler bertanggung jawab memastikan event keluar dari boundary domain menuju persistence/outbox secara aman.

---

## 20. Command Validation

Ada beberapa level validation.

### 20.1 Syntactic Validation

Validasi bentuk:

```text
caseId not blank
remarks length <= 4000
reasonCode valid format
```

Bisa dilakukan di DTO/command constructor/Bean Validation.

---

### 20.2 Semantic Validation

Validasi makna:

```text
Case exists.
Officer exists.
Case belongs to agency.
Remarks required only for certain action.
```

Biasanya di application layer.

---

### 20.3 Domain Invariant Validation

Validasi invariant domain:

```text
Only PENDING_APPROVAL case can be approved.
Closed case cannot be reopened after retention lock.
Sanction cannot be issued without confirmed violation.
```

Harus ada di domain object atau domain policy.

---

### 20.4 Authorization Validation

Validasi permission:

```text
Actor has permission to approve this case.
Actor belongs to same agency.
Actor is not approving own submitted case.
```

Ini sering campuran antara security dan domain rule. Jangan disebar random di controller, service, repository.

---

## 21. Command Authorization Pattern

Permission bisa dimodelkan per command.

```java
public interface CommandAuthorizer<C extends Command<?>> {
    AuthorizationDecision authorize(C command);
}
```

```java
public final class ApproveCaseAuthorizer
        implements CommandAuthorizer<ApproveCaseCommand> {

    private final UserPermissionRepository permissionRepository;
    private final CaseAccessRepository caseAccessRepository;

    @Override
    public AuthorizationDecision authorize(ApproveCaseCommand command) {
        boolean hasPermission = permissionRepository.hasPermission(
                command.actorId(),
                Permission.APPROVE_CASE
        );

        if (!hasPermission) {
            return AuthorizationDecision.denied("MISSING_APPROVE_CASE_PERMISSION");
        }

        boolean canAccessCase = caseAccessRepository.canAccess(
                command.actorId(),
                command.caseId()
        );

        if (!canAccessCase) {
            return AuthorizationDecision.denied("CASE_NOT_ACCESSIBLE");
        }

        return AuthorizationDecision.allowed();
    }
}
```

Authorization middleware memanggil registry:

```java
public final class CommandAuthorizationService {

    private final CommandAuthorizerRegistry registry;

    public void requireAllowed(Command<?> command) {
        AuthorizationDecision decision = registry.authorize(command);
        if (!decision.allowed()) {
            throw new ForbiddenCommandException(decision.reasons());
        }
    }
}
```

Keuntungan:

- permission logic tidak tersebar;
- bisa dites per command;
- bisa diaudit;
- bisa dijelaskan ke reviewer/security;
- bisa diubah tanpa menyentuh handler utama.

---

## 22. Chain of Responsibility untuk Business Pipeline

Chain tidak hanya untuk middleware teknis. Bisa juga untuk business processing.

Contoh assignment pipeline:

```text
AutoAssignCaseCommand
  -> check case eligible
  -> find candidate officers
  -> remove overloaded officers
  -> remove conflicted officers
  -> rank by specialization
  -> select best candidate
  -> assign case
```

Interface:

```java
public interface AssignmentStep {
    AssignmentContext apply(AssignmentContext context);
}
```

```java
public record AssignmentContext(
        CaseId caseId,
        List<OfficerCandidate> candidates,
        List<String> decisionTrace
) {
    public AssignmentContext withCandidates(List<OfficerCandidate> updated) {
        return new AssignmentContext(caseId, List.copyOf(updated), decisionTrace);
    }

    public AssignmentContext addTrace(String trace) {
        List<String> updated = new ArrayList<>(decisionTrace);
        updated.add(trace);
        return new AssignmentContext(caseId, candidates, List.copyOf(updated));
    }
}
```

Step:

```java
public final class RemoveOverloadedOfficersStep implements AssignmentStep {

    @Override
    public AssignmentContext apply(AssignmentContext context) {
        List<OfficerCandidate> filtered = context.candidates().stream()
                .filter(candidate -> candidate.activeCaseCount() < candidate.maxCaseCapacity())
                .toList();

        return context.withCandidates(filtered)
                .addTrace("Removed overloaded officers");
    }
}
```

Pipeline:

```java
public final class AssignmentPipeline {

    private final List<AssignmentStep> steps;

    public AssignmentPipeline(List<AssignmentStep> steps) {
        this.steps = List.copyOf(steps);
    }

    public AssignmentContext execute(AssignmentContext initial) {
        AssignmentContext current = initial;
        for (AssignmentStep step : steps) {
            current = step.apply(current);
        }
        return current;
    }
}
```

Ini adalah Chain/Pipeline style. Berguna jika setiap step punya reason trace dan bisa diuji secara independen.

---

## 23. Chain vs Strategy vs Decorator

Ketiganya sering mirip.

### Strategy

Memilih satu behavior dari beberapa pilihan.

```text
Choose approval policy based on case type.
```

### Chain of Responsibility

Melewati beberapa handler sampai ada yang menangani atau semua memproses berurutan.

```text
Run validation A, B, C, D.
```

### Decorator

Membungkus satu component untuk menambahkan behavior di sekelilingnya.

```text
Retry around gateway call.
Metrics around service call.
```

Middleware command bus sering merupakan gabungan Decorator dan Chain.

Perbedaan praktis:

```text
Strategy: which algorithm?
Chain: which sequence of responsibility?
Decorator: what behavior wraps another behavior?
```

---

## 24. Handler Ordering sebagai Domain Contract

Dalam sistem enterprise, ordering bukan detail teknis. Ordering sering contract bisnis.

Contoh enforcement action:

```text
1. Validate officer has jurisdiction.
2. Validate case is open.
3. Validate violation is confirmed.
4. Validate no duplicate active sanction.
5. Calculate sanction recommendation.
6. Require supervisor approval if threshold exceeded.
7. Issue sanction.
```

Jika langkah 4 dan 6 tertukar, hasil bisa beda.

Maka pipeline harus punya ordering yang eksplisit:

```java
public enum EnforcementStepOrder {
    JURISDICTION_CHECK(100),
    CASE_STATE_CHECK(200),
    VIOLATION_CHECK(300),
    DUPLICATE_SANCTION_CHECK(400),
    SANCTION_CALCULATION(500),
    SUPERVISOR_THRESHOLD_CHECK(600),
    ISSUE_SANCTION(700);

    private final int order;

    EnforcementStepOrder(int order) {
        this.order = order;
    }

    public int order() {
        return order;
    }
}
```

Tetapi jangan terlalu bergantung pada angka magic `@Order(123)`. Untuk business pipeline penting, lebih baik deklarasikan list secara eksplisit:

```java
new EnforcementPipeline(List.of(
        new JurisdictionCheckStep(...),
        new CaseStateCheckStep(...),
        new ViolationCheckStep(...),
        new DuplicateSanctionCheckStep(...),
        new SanctionCalculationStep(...),
        new SupervisorThresholdCheckStep(...),
        new IssueSanctionStep(...)
));
```

Lebih verbose, tetapi lebih readable dan defensible.

---

## 25. Command Result Design

Command result jangan asal `void`, tetapi juga jangan terlalu banyak membocorkan internal state.

Contoh terlalu miskin:

```java
void handle(ApproveCaseCommand command);
```

Masalah:

- caller tidak tahu status akhir;
- response harus query ulang;
- sulit untuk idempotency result snapshot;
- sulit audit debugging.

Contoh terlalu kaya:

```java
public record ApproveCaseResult(
        CaseAggregate aggregate,
        UserEntity actor,
        List<AuditTrailEntity> auditRows,
        List<NotificationEntity> notifications
) {}
```

Masalah:

- internal entity bocor;
- coupling tinggi;
- result jadi dumping ground.

Lebih baik:

```java
public record ApproveCaseResult(
        CaseId caseId,
        CaseStatus status,
        long version,
        Instant approvedAt
) {}
```

Result berisi outcome yang relevan untuk caller.

---

## 26. Undo/Compensation dan Command

Dalam pattern klasik, Command sering dikaitkan dengan undo.

Di enterprise systems, undo jarang sesederhana membalik method.

Approval case mungkin tidak bisa “undo” secara teknis jika sudah menghasilkan legal notification. Yang ada biasanya **compensation**:

```text
ApproveCaseCommand -> CaseApproved
ReverseApprovalCommand -> ApprovalReversed
```

Compensation adalah aksi domain baru, bukan sekadar rollback database.

Contoh:

```java
public record ReverseApprovalCommand(
        CaseId caseId,
        OfficerId actorId,
        String reason,
        CommandMetadata metadata
) implements Command<ReverseApprovalResult> {}
```

Domain harus mencatat reversal:

```text
APPROVED -> APPROVAL_REVERSED
```

Bukan menghapus fakta approval.

Untuk sistem audit/regulatory, undo fisik sering salah. Yang benar adalah event korektif yang traceable.

---

## 27. Java 8–25 Perspective

### 27.1 Java 8 Lambda

Command sederhana bisa direpresentasikan sebagai lambda jika tidak butuh identity/metadata/audit.

```java
Runnable command = () -> reportService.generateDailyReport(date);
```

Atau:

```java
Supplier<Report> command = () -> reportService.generate(date);
```

Tetapi untuk enterprise command yang butuh actor, idempotency, audit, dan validation, record/class command lebih tepat.

---

### 27.2 Functional Interface Handler

```java
@FunctionalInterface
public interface Handler<C, R> {
    R handle(C command);
}
```

Ini memudahkan composition:

```java
Handler<ApproveCaseCommand, ApproveCaseResult> handler = command -> {
    // execute
};
```

Tetapi jangan mengorbankan readability jika logic besar.

---

### 27.3 Records

Records sangat cocok untuk command immutable:

```java
public record AssignCaseCommand(
        CaseId caseId,
        OfficerId assigneeId,
        OfficerId assignedBy,
        CommandMetadata metadata
) implements Command<AssignCaseResult> {}
```

Kelebihan:

- concise;
- immutable shallowly;
- value semantics;
- easy logging with care;
- clear constructor.

Catatan:

- jangan taruh data sensitive di `toString()` tanpa kontrol;
- jangan membawa mutable list tanpa defensive copy;
- compact constructor tetap diperlukan untuk invariant.

---

### 27.4 Sealed Interface untuk Command Hierarchy

Jika command set tertutup dalam module:

```java
public sealed interface CaseCommand<R> extends Command<R>
        permits ApproveCaseCommand,
                RejectCaseCommand,
                AssignCaseCommand,
                EscalateCaseCommand {

    CaseId caseId();
    OfficerId actorId();
    CommandMetadata metadata();
}
```

Kelebihan:

- compiler tahu semua subtype;
- switch pattern matching bisa exhaustive;
- bagus untuk module boundary.

Tetapi jangan pakai sealed jika command harus extensible oleh plugin luar.

---

### 27.5 Pattern Matching Switch

Dengan sealed commands:

```java
public String commandName(CaseCommand<?> command) {
    return switch (command) {
        case ApproveCaseCommand ignored -> "APPROVE_CASE";
        case RejectCaseCommand ignored -> "REJECT_CASE";
        case AssignCaseCommand ignored -> "ASSIGN_CASE";
        case EscalateCaseCommand ignored -> "ESCALATE_CASE";
    };
}
```

Ini bisa menggantikan beberapa visitor/if-else untuk metadata mapping.

Tetapi jangan gunakan switch besar untuk business execution jika setiap command punya handler sendiri.

---

### 27.6 Virtual Threads

Virtual threads membuat synchronous command handler lebih scalable untuk blocking I/O.

Implikasi:

- tidak semua command harus dipaksa reactive;
- handler bisa tetap sequential dan readable;
- fan-out command execution harus tetap punya timeout/cancellation;
- ThreadLocal usage harus hati-hati;
- idempotency dan transaction semantics tetap wajib.

Virtual thread tidak menghilangkan kebutuhan pattern. Ia mengubah cost model concurrency.

---

### 27.7 Scoped Values dan Structured Concurrency

Di Java modern, request context bisa lebih aman dimodelkan daripada ThreadLocal tradisional.

Untuk command execution, context seperti correlation id dan actor bisa dipropagasikan secara eksplisit atau via scoped mechanism.

Namun command object sendiri tetap lebih defensible untuk data bisnis penting. Jangan menyembunyikan semua context dalam ThreadLocal/ScopedValue sampai handler signature kehilangan makna.

Buruk:

```java
approveCaseHandler.handle(new ApproveCaseCommand(caseId, remarks));
// actor, tenant, correlation id tersembunyi semua di context global
```

Lebih jelas:

```java
approveCaseHandler.handle(new ApproveCaseCommand(
        caseId,
        actorId,
        remarks,
        metadata
));
```

Context propagation membantu observability. Command tetap membawa intent.

---

## 28. Anti-Pattern Catalog

### 28.1 Command as Anemic Wrapper

```java
public record ApproveCaseCommand(String caseId, String officerId, String remarks) {}
```

Lalu semua logic tetap di god service tanpa perubahan struktur.

Gejala:

- command hanya mengganti parameter list;
- tidak ada metadata;
- tidak ada handler boundary;
- tidak ada idempotency;
- tidak ada validation model;
- tidak ada semantic improvement.

Solusi:

- pastikan command merepresentasikan use case;
- pindahkan execution ke handler;
- tambahkan metadata yang relevan;
- pisahkan transport DTO dari command.

---

### 28.2 God Command Handler

Satu handler melakukan segalanya:

```text
validate
load
authorize
calculate
mutate
save
send email
call external API
write audit
publish Kafka
update cache
build response
```

Solusi:

- pisahkan policy;
- pisahkan authorizer;
- pisahkan gateway;
- gunakan outbox;
- gunakan domain behavior;
- jadikan handler orchestrator, bukan dump site.

---

### 28.3 Handler Explosion

Setiap operasi kecil dibuat handler sendiri sampai codebase penuh class kecil tanpa makna.

Contoh:

```text
TrimRemarksHandler
NormalizeCaseIdHandler
SetApprovedAtHandler
SetApprovedByHandler
UpdateStatusHandler
```

Ini bukan Command Handler. Ini fragmentasi.

Solusi:

- command handler per use case signifikan;
- step kecil hanya dibuat class jika punya reuse, testing value, atau business meaning;
- jangan membuat class hanya demi pattern.

---

### 28.4 God Command Bus

Command bus yang terlalu pintar:

```text
routing
validation
authorization
transaction
retry
audit
event publishing
async scheduling
error mapping
permission mapping
workflow transition
notification
```

Semua terjadi implicit.

Solusi:

- command bus hanya dispatch + middleware;
- middleware eksplisit;
- business logic tetap di handler/domain;
- dokumentasikan order;
- test middleware chain.

---

### 28.5 Chain with Hidden Side Effects

Validation chain ternyata mengubah database.

```java
public ValidationResult validate(ApproveCaseCommand command) {
    auditRepository.save(...); // hidden side effect
    return ValidationResult.ok();
}
```

Ini berbahaya karena caller mengira validation pure.

Solusi:

- beri nama step sesuai side effect;
- pisahkan validation dari mutation;
- enforce convention;
- test no side-effect jika perlu.

---

### 28.6 Stringly Typed Command Routing

```java
handlerRegistry.get(command.type()).handle(command);
```

Dengan command type berupa string:

```text
"APPROVE"
"Approve"
"APPROVE_CASE"
"approve-case"
```

Solusi:

- gunakan class-based routing;
- gunakan enum jika command set fixed;
- gunakan sealed hierarchy jika cocok;
- validasi unknown command dengan jelas.

---

### 28.7 Command Carrying Entity

```java
public record ApproveCaseCommand(
        CaseEntity caseEntity,
        UserEntity userEntity
) {}
```

Masalah:

- command membawa mutable object graph;
- entity mungkin detached;
- stale state;
- serialization sulit;
- idempotency hash tidak jelas;
- command tidak aman untuk async.

Solusi:

- command membawa identity dan input;
- handler load aggregate fresh dalam transaction.

---

### 28.8 Command Without Actor

```java
public record ApproveCaseCommand(CaseId caseId, String remarks) {}
```

Actor diambil dari global context tersembunyi.

Masalah:

- audit sulit;
- test sulit;
- async command kehilangan user context;
- security ambiguity;
- replay ambiguity.

Solusi:

- command mutating penting harus membawa actor atau explicit system actor.

---

### 28.9 Retry Without Idempotency

Command diretry otomatis tanpa idempotency.

Akibat:

- duplicate audit;
- duplicate notification;
- duplicate event;
- duplicate payment/action;
- state corruption.

Solusi:

- idempotency key;
- outbox;
- retry only safe boundary;
- classify retryable failure.

---

### 28.10 Async Command as Fire-and-Forget

```java
executor.submit(() -> commandBus.dispatch(command));
return ResponseEntity.accepted().build();
```

Tanpa persistence, tracking, retry, error handling.

Masalah:

- task hilang saat process mati;
- user tidak tahu status;
- error tidak terlihat;
- duplicate tidak dicegah.

Solusi:

- persist command/job;
- status tracking;
- retry policy;
- dead letter handling;
- idempotency.

---

## 29. Refactoring Path: Dari Service Method ke Command Handler

Misal awalnya:

```java
public void approveCase(String caseId, String officerId, String remarks) {
    // huge method
}
```

### Step 1 — Introduce Command Object

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId officerId,
        String remarks,
        CommandMetadata metadata
) {}
```

Service method tetap ada:

```java
public ApproveCaseResult approveCase(String caseId, String officerId, String remarks) {
    return approveCase(new ApproveCaseCommand(...));
}
```

---

### Step 2 — Extract Handler

```java
public final class ApproveCaseHandler {
    public ApproveCaseResult handle(ApproveCaseCommand command) {
        // move use case logic here
    }
}
```

Old service delegates:

```java
public ApproveCaseResult approveCase(...) {
    return approveCaseHandler.handle(command);
}
```

---

### Step 3 — Extract Policy/Specification

Move approval condition:

```java
ApprovalDecision decision = approvalPolicy.evaluate(caseAggregate, command.officerId());
```

---

### Step 4 — Move Domain Mutation into Aggregate

From:

```java
entity.setStatus(APPROVED);
```

To:

```java
caseAggregate.approve(command.officerId(), command.remarks(), clock.instant());
```

---

### Step 5 — Separate Side Effects

From inline email/event:

```java
emailService.send(...);
eventPublisher.publish(...);
```

To outbox:

```java
outbox.saveAll(caseAggregate.pullDomainEvents());
```

---

### Step 6 — Introduce Middleware Only If Useful

Only after multiple handlers share concerns:

```text
ValidationMiddleware
AuthorizationMiddleware
IdempotencyMiddleware
TransactionMiddleware
LoggingMiddleware
```

Jangan mulai dari command bus jika satu handler saja.

---

### Step 7 — Add Idempotency Where Needed

Add key and store for externally retried commands.

---

### Step 8 — Remove Old Method or Keep as Facade

Jika public API masih perlu method lama, jadikan facade tipis.

---

## 30. Testing Strategy

### 30.1 Command Constructor Test

Test input invariant:

```java
@Test
void shouldRejectBlankRemarks() {
    assertThrows(IllegalArgumentException.class, () ->
            new ApproveCaseCommand(
                    new CaseId("CASE-1"),
                    new OfficerId("OFF-1"),
                    " ",
                    metadata()
            )
    );
}
```

---

### 30.2 Handler Unit Test

Mock repository/policy if domain object is heavy:

```java
@Test
void shouldApprovePendingCase() {
    CaseAggregate aggregate = CaseAggregate.pending(new CaseId("CASE-1"));

    when(caseRepository.getRequired(aggregate.id())).thenReturn(aggregate);
    when(approvalPolicy.evaluate(aggregate, new OfficerId("OFF-1")))
            .thenReturn(ApprovalDecision.allowed());

    ApproveCaseResult result = handler.handle(new ApproveCaseCommand(
            aggregate.id(),
            new OfficerId("OFF-1"),
            "Approved after review",
            metadata()
    ));

    assertEquals(CaseStatus.APPROVED, result.status());
    verify(caseRepository).save(aggregate);
}
```

---

### 30.3 Domain Invariant Test

```java
@Test
void shouldRejectApprovalWhenCaseAlreadyClosed() {
    CaseAggregate aggregate = CaseAggregate.closed(new CaseId("CASE-1"));

    assertThrows(IllegalTransitionException.class, () ->
            aggregate.approve(new OfficerId("OFF-1"), "remarks", Instant.now())
    );
}
```

---

### 30.4 Middleware Ordering Test

```java
@Test
void shouldInvokeMiddlewaresInOrder() {
    List<String> calls = new ArrayList<>();

    CommandMiddleware first = (command, next) -> {
        calls.add("first-before");
        Object result = next.proceed();
        calls.add("first-after");
        return result;
    };

    CommandMiddleware second = (command, next) -> {
        calls.add("second-before");
        Object result = next.proceed();
        calls.add("second-after");
        return result;
    };

    CommandBus bus = new MiddlewareCommandBus(
            command -> {
                calls.add("handler");
                return "ok";
            },
            List.of(first, second)
    );

    bus.dispatch(new TestCommand());

    assertEquals(List.of(
            "first-before",
            "second-before",
            "handler",
            "second-after",
            "first-after"
    ), calls);
}
```

---

### 30.5 Idempotency Test

Test duplicate command returns previous result and does not execute handler again.

```java
@Test
void shouldReturnExistingResultForDuplicateCommand() {
    IdempotencyStore store = new InMemoryIdempotencyStore();
    AtomicInteger executions = new AtomicInteger();

    CommandBus terminal = command -> {
        executions.incrementAndGet();
        return new ApproveCaseResult(new CaseId("CASE-1"), CaseStatus.APPROVED, 2, Instant.now());
    };

    CommandBus bus = new MiddlewareCommandBus(
            terminal,
            List.of(new IdempotencyMiddleware(store))
    );

    ApproveCaseCommand command = approveCommandWithKey("KEY-1");

    bus.dispatch(command);
    bus.dispatch(command);

    assertEquals(1, executions.get());
}
```

---

## 31. Observability and Debugging Angle

Command pattern sangat cocok untuk observability karena command punya nama aksi eksplisit.

Log yang baik:

```text
command=ApproveCaseCommand
caseId=CASE-123
actorId=OFF-456
correlationId=abc-123
idempotencyKey=req-789
result=APPROVED
durationMs=142
```

Metrics:

```text
command.execution.count{command="ApproveCaseCommand", result="success"}
command.execution.count{command="ApproveCaseCommand", result="validation_failed"}
command.execution.duration{command="ApproveCaseCommand"}
command.idempotency.duplicate.count{command="ApproveCaseCommand"}
command.authorization.denied.count{command="ApproveCaseCommand"}
```

Trace span:

```text
Span: Command ApproveCaseCommand
  attributes:
    command.name=ApproveCaseCommand
    case.id=CASE-123
    actor.type=OFFICER
    idempotency.hit=false
```

Jangan log full command sembarangan karena command bisa membawa PII atau sensitive business data.

Buruk:

```java
log.info("Handling command {}", command);
```

Jika record `toString()` mengandung NRIC/email/address/remarks sensitif, ini bocor.

Lebih baik log selected safe fields.

---

## 32. Security Consideration

Command mutating harus memperhatikan:

1. Actor explicit.
2. Authorization per command.
3. Target resource explicit.
4. No trust in client-provided actor.
5. Audit metadata lengkap.
6. Command replay protection jika endpoint sensitif.
7. Idempotency key tidak boleh mudah disalahgunakan antar actor.
8. Command result tidak membocorkan resource yang tidak boleh diakses.

Contoh risiko:

```java
public record ApproveCaseCommand(
        CaseId caseId,
        OfficerId actorId,
        String remarks
) {}
```

Jika `actorId` diambil dari request body, user bisa spoof.

Lebih baik:

```java
OfficerId actorId = currentUser.officerId();
ApproveCaseCommand command = new ApproveCaseCommand(caseId, actorId, remarks, metadata);
```

Actor berasal dari authenticated server context, bukan input client mentah.

---

## 33. Performance Consideration

Command/handler sendiri biasanya murah. Performance issue muncul dari:

- command bus reflection lookup;
- excessive proxy layers;
- synchronous side effects;
- transaction terlalu panjang;
- validation melakukan query berulang;
- chain terlalu banyak step dengan I/O;
- logging full payload;
- idempotency store bottleneck;
- handler fan-out tanpa timeout.

Guideline:

1. Command object kecil dan immutable.
2. Handler load data seperlunya.
3. Hindari external call dalam transaction jika tidak perlu.
4. Gunakan outbox untuk side effect.
5. Cache metadata handler jika reflection dipakai.
6. Monitor duration per command type.
7. Batasi chain untuk concern yang benar-benar bernilai.

---

## 34. Case Study: Case Lifecycle Operation

### 34.1 Problem

Operasi `submitCaseForApproval` awal:

```java
public void submitCaseForApproval(String caseId, String userId, String remarks) {
    CaseEntity c = repo.find(caseId);

    if (!security.canSubmit(userId, c)) throw new ForbiddenException();
    if (!c.getStatus().equals("DRAFT")) throw new BadRequestException();
    if (remarks == null) throw new BadRequestException();

    c.setStatus("PENDING_APPROVAL");
    c.setSubmittedBy(userId);
    c.setSubmittedAt(new Date());
    repo.save(c);

    audit.log("submitted");
    email.send(c.getSupervisorEmail(), "Case submitted");
    kafka.publish("case-submitted", caseId);
}
```

Problems:

- transport/user/domain concern mixed;
- no idempotency;
- event published possibly before durable commit depending implementation;
- email failure can fail command;
- status stringly typed;
- no reason trace;
- no command-level metric;
- hard to test.

---

### 34.2 Target Design

```text
SubmitCaseForApprovalCommand
  -> ValidationMiddleware
  -> AuthorizationMiddleware
  -> IdempotencyMiddleware
  -> TransactionMiddleware
  -> SubmitCaseForApprovalHandler
       -> load CaseAggregate
       -> submitForApproval(...)
       -> save aggregate
       -> save outbox events
  -> result
```

Command:

```java
public record SubmitCaseForApprovalCommand(
        CaseId caseId,
        UserId submittedBy,
        String remarks,
        CommandMetadata metadata
) implements IdempotentCommand<SubmitCaseForApprovalResult> {

    public SubmitCaseForApprovalCommand {
        Objects.requireNonNull(caseId);
        Objects.requireNonNull(submittedBy);
        Objects.requireNonNull(metadata);
        if (remarks == null || remarks.isBlank()) {
            throw new IllegalArgumentException("remarks must not be blank");
        }
    }

    @Override
    public String idempotencyKey() {
        return metadata.idempotencyKey();
    }
}
```

Domain:

```java
public final class CaseAggregate {

    private CaseStatus status;
    private final List<DomainEvent> events = new ArrayList<>();

    public void submitForApproval(UserId userId, String remarks, Instant submittedAt) {
        if (status != CaseStatus.DRAFT) {
            throw new IllegalTransitionException(status, CaseStatus.PENDING_APPROVAL);
        }

        this.status = CaseStatus.PENDING_APPROVAL;
        this.submittedBy = userId;
        this.submittedAt = submittedAt;

        events.add(new CaseSubmittedForApproval(id, userId, submittedAt));
    }
}
```

Handler:

```java
public final class SubmitCaseForApprovalHandler
        implements CommandHandler<SubmitCaseForApprovalCommand, SubmitCaseForApprovalResult> {

    private final CaseRepository caseRepository;
    private final Clock clock;
    private final Outbox outbox;

    @Override
    public SubmitCaseForApprovalResult handle(SubmitCaseForApprovalCommand command) {
        CaseAggregate aggregate = caseRepository.getRequired(command.caseId());

        aggregate.submitForApproval(
                command.submittedBy(),
                command.remarks(),
                clock.instant()
        );

        caseRepository.save(aggregate);
        outbox.saveAll(aggregate.pullDomainEvents(), command.metadata());

        return new SubmitCaseForApprovalResult(
                aggregate.id(),
                aggregate.status(),
                aggregate.version()
        );
    }
}
```

Result:

```java
public record SubmitCaseForApprovalResult(
        CaseId caseId,
        CaseStatus status,
        long version
) {}
```

---

### 34.3 Outcome

Perubahan desain:

```text
Before:
Controller/Service method with mixed concerns.

After:
Command models intent.
Handler executes use case.
Domain owns invariant.
Middleware handles cross-cutting concerns.
Outbox handles post-commit side effect.
```

Keuntungan:

- behavior lebih testable;
- audit lebih jelas;
- retry lebih aman;
- failure semantics lebih eksplisit;
- authorization lebih terstruktur;
- side effect tidak mengacaukan transaction;
- command bisa dipanggil dari REST, batch, queue, atau internal workflow.

---

## 35. Design Review Checklist

Gunakan checklist ini saat review command/handler/chain design.

### 35.1 Command Checklist

```text
[ ] Nama command menyatakan aksi bisnis, bukan transport detail.
[ ] Command membawa target resource yang jelas.
[ ] Command membawa actor/system actor yang jelas.
[ ] Command membawa metadata operasi yang relevan.
[ ] Command immutable.
[ ] Command tidak membawa mutable entity/object graph.
[ ] Command tidak mencampur HTTP/framework detail.
[ ] Field command memakai domain primitive jika penting.
[ ] Idempotency key tersedia jika command bisa diretry/di-double-submit.
[ ] Sensitive field tidak bocor lewat toString/log.
```

### 35.2 Handler Checklist

```text
[ ] Handler fokus pada satu use case.
[ ] Handler bukan god service.
[ ] Handler tidak mengambil alih semua domain invariant.
[ ] Handler memanggil domain behavior/policy yang tepat.
[ ] Transaction boundary jelas.
[ ] External side effect tidak dilakukan sembarangan dalam transaction.
[ ] Result cukup informatif tetapi tidak membocorkan internal entity.
[ ] Error semantics jelas.
[ ] Handler bisa dites tanpa full application container jika memungkinkan.
```

### 35.3 Chain Checklist

```text
[ ] Urutan chain eksplisit.
[ ] Setiap middleware punya responsibility jelas.
[ ] Short-circuit behavior terdokumentasi.
[ ] Middleware tidak menyembunyikan side effect yang mengejutkan.
[ ] Authorization terjadi sebelum mutation.
[ ] Idempotency terjadi sebelum mutation.
[ ] Logging/metrics tidak membocorkan sensitive data.
[ ] Transaction tidak dibuka terlalu awal jika tidak perlu.
[ ] Chain tidak menjadi magic box.
```

### 35.4 Idempotency Checklist

```text
[ ] Duplicate completed command mengembalikan result konsisten.
[ ] Same key dengan different payload ditolak.
[ ] In-progress duplicate punya policy jelas.
[ ] Failure retry policy jelas.
[ ] Result snapshot aman disimpan.
[ ] Idempotency key scope mencakup actor/tenant/command type jika perlu.
[ ] Idempotency store punya TTL/cleanup.
```

---

## 36. Common Staff-Level Discussion

### 36.1 “Apakah semua service method harus jadi command?”

Tidak.

Command berguna jika operasi punya salah satu dari ini:

- mutation penting;
- audit requirement;
- authorization kompleks;
- retry/idempotency;
- workflow transition;
- multiple entrypoint;
- asynchronous processing;
- side effect;
- compliance traceability.

Untuk CRUD sederhana internal, service method biasa bisa cukup.

Top engineer tidak memaksakan pattern. Ia melihat design force.

---

### 36.2 “Command Bus wajib?”

Tidak.

Command handler bisa dipanggil langsung.

Command bus berguna saat banyak command membutuhkan middleware konsisten.

Jika command bus hanya membuat call stack lebih rumit tanpa benefit, itu overengineering.

---

### 36.3 “Apakah Command sama dengan CQRS?”

Tidak.

Command bisa dipakai tanpa CQRS penuh. CQRS memisahkan model command dan query secara architectural. Command pattern hanya memodelkan intent mutation.

Kamu bisa punya command handler dalam layered architecture biasa.

---

### 36.4 “Apakah handler boleh memanggil handler lain?”

Hati-hati.

Handler memanggil handler lain bisa menyebabkan:

- transaction nesting ambiguity;
- authorization double/skip;
- audit duplicate;
- hidden workflow;
- cyclic use case dependency.

Lebih baik extract shared domain service atau application service internal jika memang ada reusable operation.

Jika command A memang menyebabkan command B setelah commit, gunakan event/outbox/job dengan semantics jelas.

---

### 36.5 “Apakah command harus serializable?”

Tergantung.

Jika command hanya in-process, tidak harus.

Jika command disimpan, dikirim ke queue, atau diretry lintas process, command perlu punya stable serialization contract. Dalam kasus itu:

- hindari entity object;
- pakai primitive/domain primitive sederhana;
- version command schema;
- simpan metadata;
- jaga backward compatibility.

---

## 37. Practical Heuristics

Gunakan Command jika:

```text
Operation penting secara bisnis.
Operation mengubah state.
Operation butuh audit.
Operation punya authorization.
Operation punya idempotency/retry risk.
Operation bisa datang dari REST, batch, queue, atau workflow.
Operation punya side effect.
Operation punya lifecycle/failure semantics.
```

Gunakan Handler jika:

```text
Use case cukup besar untuk punya boundary sendiri.
Kamu ingin test per operation.
Kamu ingin memisahkan application orchestration dari domain behavior.
```

Gunakan Chain jika:

```text
Ada beberapa concern berurutan.
Urutan penting.
Concern bisa reuse.
Concern bisa short-circuit.
Kamu butuh visibility atas pipeline.
```

Jangan gunakan jika:

```text
Operasi sangat sederhana.
Pattern hanya mengganti parameter list dengan object tanpa semantic gain.
Team belum punya kebutuhan middleware.
Abstraksi membuat debugging lebih sulit daripada problem aslinya.
```

---

## 38. Ringkasan Mental Model

Command pattern bukan tentang membuat class bernama `SomethingCommand`.

Command pattern adalah cara memodelkan **intent** sebagai objek eksplisit.

Command Handler bukan sekadar class service baru.

Command Handler adalah boundary eksekusi use case.

Chain of Responsibility bukan sekadar daftar interceptor.

Chain adalah cara memodelkan urutan responsibility yang bisa memproses, menolak, memperkaya, atau meneruskan operasi.

Dalam sistem Java enterprise yang besar, pola ini membantu menjawab:

```text
Aksi apa yang diminta?
Siapa yang meminta?
Targetnya apa?
Apakah boleh?
Apakah valid?
Apakah state transition sah?
Apakah aman diretry?
Apa hasilnya?
Apa side effect-nya?
Apa yang harus diaudit?
Apa yang terjadi saat gagal?
```

Engineer level senior/top tidak memakai Command karena “pattern bagus”. Ia memakai Command ketika operasi bisnis perlu menjadi unit yang bisa dipahami, diuji, diaudit, diretry, dan dikontrol.

---

## 39. Koneksi ke Part Berikutnya

Bagian berikutnya adalah:

```text
12-behavioral-observer-listener-event-pubsub.md
```

Command dan Event adalah pasangan penting:

```text
Command: intent sebelum perubahan
Event: fakta setelah perubahan
```

Jika Part 11 menjawab:

```text
Bagaimana aksi diminta dan dieksekusi?
```

Part 12 akan menjawab:

```text
Bagaimana sistem bereaksi terhadap fakta yang sudah terjadi tanpa membuat dependency tersembunyi dan event chaos?
```

---

## Status Seri

```text
Part 11 dari 35 selesai.
Seri belum selesai.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./10-behavioral-strategy-policy-specification-rule-object.md">⬅️ Part 10 — Behavioral Pattern I: Strategy, Policy, Specification, Rule Object</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./12-behavioral-observer-listener-event-pubsub.md">Behavioral Pattern IV: Observer, Listener, Event, Pub/Sub ➡️</a>
</div>
