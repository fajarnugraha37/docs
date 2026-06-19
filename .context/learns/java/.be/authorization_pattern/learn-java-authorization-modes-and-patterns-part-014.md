# learn-java-authorization-modes-and-patterns-part-014

# Part 14 — Spring Method Security: Service-Level Authorization

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> Bagian: **14 dari 35**  
> Fokus: **Spring method security sebagai service-level authorization boundary**  
> Target: Java 8–25, dengan catatan kompatibilitas Spring Security legacy sampai modern

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 13 kita membahas authorization di level HTTP request pada Servlet stack: filter chain, request matcher, multiple chain, role prefix, public endpoint, static assets, actuator, dan testing request authorization.

Part 14 naik satu lapis ke **method security**, yaitu authorization yang terjadi ketika method service dipanggil.

Secara mental model:

```text
HTTP request authorization menjawab:
"Apakah request ini boleh masuk ke endpoint ini?"

Method security menjawab:
"Apakah caller ini boleh menjalankan business operation ini dengan argument ini?"
```

Perbedaannya sangat penting.

Endpoint-level authorization sering hanya tahu:

```text
POST /cases/{id}/approve
```

Method-level authorization bisa tahu:

```java
approveCase(caseId, decision, comment)
```

Dan business service bisa memuat konteks:

```text
- caseId yang dimaksud
- actor yang memanggil
- current case state
- assigned officer
- maker-checker rule
- agency boundary
- escalation path
- delegation
- permission effective at time of action
```

Itulah alasan method security sering menjadi boundary authorization yang lebih tepat untuk sistem enterprise.

---

## 1. Tujuan Pembelajaran

Setelah bagian ini, kamu harus bisa:

1. Memahami peran method security dalam arsitektur authorization Java/Spring.
2. Membedakan request-level authorization, service-level authorization, dan domain-level authorization.
3. Menggunakan `@PreAuthorize`, `@PostAuthorize`, `@PreFilter`, dan `@PostFilter` secara tepat.
4. Memahami bahaya SpEL yang terlalu kompleks.
5. Mendesain custom authorization logic yang tetap testable dan auditable.
6. Menghindari proxy trap, self-invocation bug, annotation inheritance confusion, dan ordering problem dengan transaction.
7. Memutuskan kapan annotation cukup dan kapan harus memakai explicit `AuthorizationService` / `PolicyService`.
8. Menulis test method security yang bukan hanya happy path.
9. Melakukan migration dari `@Secured` / `@RolesAllowed` / expression-heavy security ke authorization model yang lebih matang.

---

## 2. Mental Model: Method Security Adalah Guard Untuk Business Operation

Method security bukan sekadar cara lain menulis role check.

Method security adalah **guard di depan business operation**.

Contoh operasi bisnis:

```java
caseService.approve(caseId, decision);
caseService.assign(caseId, officerId);
appealService.submit(applicationId, appealRequest);
reportService.exportMonthlyReport(criteria);
documentService.download(documentId);
```

Setiap operasi memiliki semantic yang lebih kaya daripada HTTP path.

Contoh:

```http
POST /cases/100/approve
```

Secara route, mungkin cukup:

```java
.requestMatchers(HttpMethod.POST, "/cases/*/approve").hasAuthority("case.approve")
```

Tapi route check tidak menjawab:

```text
- Apakah case 100 berada dalam agency user?
- Apakah case 100 sedang berada di state REVIEW_PENDING?
- Apakah user ini reviewer yang assigned?
- Apakah user ini bukan submitter sebelumnya?
- Apakah case ini locked oleh workflow lain?
- Apakah user sedang acting sebagai delegate valid?
- Apakah approval masih dalam SLA window?
```

Service method punya argument dan domain context yang jauh lebih dekat ke keputusan yang benar.

Jadi method security bukan pengganti request security. Keduanya menjawab pertanyaan berbeda.

```text
Request security:
- coarse entry protection
- endpoint exposure control
- protocol boundary
- unauthenticated/unauthorized request blocking

Method security:
- operation-level protection
- argument-aware authorization
- reusable business service guard
- protection dari non-HTTP caller
```

---

## 3. Kenapa Method Security Penting

### 3.1 Business service bisa dipanggil dari banyak entry point

Dalam aplikasi enterprise, service tidak selalu dipanggil dari controller HTTP.

Sumber pemanggil bisa berupa:

```text
- REST controller
- GraphQL resolver
- gRPC endpoint
- scheduled job
- message consumer
- batch job
- admin console
- internal service facade
- test harness
- CLI tool
- workflow engine delegate
```

Kalau authorization hanya di controller, maka service yang sama bisa dibypass dari entry point lain.

Contoh:

```java
@RestController
class CaseController {

    @PostMapping("/cases/{id}/approve")
    @PreAuthorize("hasAuthority('case.approve')")
    void approve(@PathVariable long id) {
        caseService.approve(id);
    }
}
```

Lalu kemudian ada Kafka consumer:

```java
@Component
class ApprovalCommandConsumer {

    @KafkaListener(topics = "case-approval-command")
    void consume(ApprovalCommand command) {
        caseService.approve(command.caseId());
    }
}
```

Kalau authorization hanya di controller, Kafka path menjadi bypass.

Dengan method security:

```java
@Service
class CaseService {

    @PreAuthorize("@caseAuthz.canApprove(authentication, #caseId)")
    public void approve(long caseId) {
        // business operation
    }
}
```

Maka semua caller tetap melewati guard yang sama, selama call melewati Spring proxy.

### 3.2 Method punya parameter

Authorization sering membutuhkan argument.

```java
@PreAuthorize("@caseAuthz.canView(authentication, #caseId)")
public CaseDetail getCaseDetail(long caseId) { ... }
```

Ini lebih presisi daripada:

```java
@PreAuthorize("hasAuthority('case.read')")
```

Karena permission umum `case.read` belum menjamin user boleh membaca **case tertentu**.

### 3.3 Method security dekat dengan use case

Business operation biasanya sudah bernama sesuai intent.

```java
submitAppeal(...)
approveCase(...)
returnCaseForClarification(...)
assignInvestigator(...)
closeCase(...)
exportInspectionReport(...)
```

Nama method memberi semantic yang lebih stabil daripada path HTTP.

Path bisa berubah.

```text
/v1/cases/{id}/approve
/v2/work-items/{id}/decision
/internal/case-approval/{id}
```

Tapi use case authorization tetap sama:

```text
case.approve
```

---

## 4. Spring Method Security: Komponen Dasar

Spring method security modern diaktifkan dengan:

```java
@Configuration
@EnableMethodSecurity
class MethodSecurityConfig {
}
```

Secara konseptual, Spring membuat proxy di sekitar bean yang diamankan. Ketika method dipanggil melalui proxy, interceptor method security mengevaluasi annotation seperti:

```java
@PreAuthorize
@PostAuthorize
@PreFilter
@PostFilter
@Secured
@RolesAllowed
```

Jika authorization gagal, Spring melempar `AccessDeniedException`.

Diagram sederhana:

```text
Caller
  |
  v
Spring proxy
  |
  +--> method security interceptor
          |
          +--> read Authentication from SecurityContext
          +--> evaluate authorization expression / manager
          +--> allow or deny
  |
  v
Target service method
```

Hal penting:

```text
Method security bekerja saat call melewati proxy.
```

Ini akan menjadi sumber banyak bug yang akan kita bahas.

---

## 5. Annotation Utama

### 5.1 `@PreAuthorize`

`@PreAuthorize` mengevaluasi authorization **sebelum method dieksekusi**.

Contoh:

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approveCase(long caseId) {
    // only called if allowed
}
```

Contoh argument-aware:

```java
@PreAuthorize("@caseAuthorization.canApprove(authentication, #caseId)")
public void approveCase(long caseId) {
    // only called if user can approve this specific case
}
```

Gunakan untuk:

```text
- mutation
- command operation
- sensitive read
- operation yang harus dicegah sebelum side effect
```

Kelebihan:

```text
- tidak menjalankan method jika tidak allowed
- cocok untuk write operation
- mudah dipahami
- bisa memakai argument method
```

Keterbatasan:

```text
- belum punya return object
- jika butuh resource attribute, harus load resource di authorization service
- bisa menyebabkan duplicate load jika service method juga load resource
```

Contoh duplicate load:

```java
@PreAuthorize("@caseAuthz.canApprove(authentication, #caseId)")
public void approve(long caseId) {
    Case caze = caseRepository.findById(caseId).orElseThrow();
    caze.approve();
}
```

`caseAuthz.canApprove` mungkin juga load case.

Solusinya nanti:

```text
- use command object carrying verified resource snapshot
- combine authorization and resource loading carefully
- use domain service that returns AuthorizedResource
- use transaction-scoped cache
- use explicit authorization flow inside service
```

### 5.2 `@PostAuthorize`

`@PostAuthorize` mengevaluasi authorization **setelah method dieksekusi**, biasanya menggunakan `returnObject`.

Contoh:

```java
@PostAuthorize("@caseAuthorization.canView(authentication, returnObject)")
public CaseDetail getCaseDetail(long caseId) {
    return caseRepository.findDetail(caseId);
}
```

Gunakan ketika:

```text
- resource harus di-load dulu sebelum authorization bisa dievaluasi
- method read-only
- tidak ada side effect sebelum authorization
- return object kecil dan tunggal
```

Bahaya:

```text
Method sudah berjalan sebelum authorization diputuskan.
```

Untuk mutation, ini sering salah.

Buruk:

```java
@PostAuthorize("@caseAuthz.canApprove(authentication, returnObject)")
public ApprovalResult approve(long caseId) {
    // mutation already happened before authorization check
}
```

Jika method melakukan side effect lalu `@PostAuthorize` deny, side effect belum tentu otomatis rollback kecuali exception terjadi dalam transaction yang benar.

Bahkan jika rollback terjadi, side effect eksternal bisa sudah terjadi:

```text
- email terkirim
- event published
- file generated
- audit written
- downstream API called
```

Jadi rule praktis:

```text
Gunakan @PostAuthorize terutama untuk read operation, bukan write operation.
```

### 5.3 `@PreFilter`

`@PreFilter` memfilter collection argument sebelum method berjalan.

Contoh:

```java
@PreFilter("@caseAuthorization.canUpdate(authentication, filterObject)")
public void bulkUpdate(List<Long> caseIds) {
    // only allowed case IDs remain
}
```

Masalahnya: filter silently removes disallowed items.

Dalam banyak business flow, ini berbahaya.

Misalnya user meminta update 10 case, tetapi 3 case tidak authorized. Apakah seharusnya:

```text
- 7 diproses dan 3 diabaikan?
- seluruh request gagal?
- response partial success?
- denial diaudit?
```

`@PreFilter` cenderung menyembunyikan keputusan tersebut.

Untuk sistem enterprise/regulatory, lebih baik explicit:

```java
public BulkDecision authorizeBulkUpdate(User user, List<Long> caseIds) {
    // return allowed, denied, reasons
}
```

Gunakan `@PreFilter` dengan hati-hati, terutama untuk operation non-critical atau read-only filtering.

### 5.4 `@PostFilter`

`@PostFilter` memfilter collection return value setelah method selesai.

Contoh:

```java
@PostFilter("@caseAuthorization.canView(authentication, filterObject)")
public List<CaseSummary> findCases(SearchCriteria criteria) {
    return caseRepository.search(criteria);
}
```

Ini sering terlihat nyaman, tapi dapat menjadi anti-pattern.

Masalah:

```text
- data unauthorized sudah di-fetch dari database
- pagination rusak
- count salah
- performance buruk
- aggregation leakage tetap mungkin
- audit sulit
```

Contoh pagination bug:

```text
Query DB:
  page size = 20
  DB returns 20 rows

@PostFilter removes 15 rows
User sees 5 rows

Next page:
  DB offset already advanced
  user may never see authorized rows that were pushed to next page
```

Untuk list/search/report, lebih baik authorization masuk ke query predicate.

```java
public Page<CaseSummary> searchCases(SearchCriteria criteria, UserContext user) {
    CaseVisibilityScope scope = caseAuthz.visibilityScope(user);
    return caseRepository.search(criteria, scope.toPredicate());
}
```

Rule praktis:

```text
@PostFilter boleh untuk small in-memory list.
@PostFilter buruk untuk large search, pagination, report, export, dan aggregation.
```

### 5.5 `@Secured`

`@Secured` annotation lama yang berbasis role/authority string.

```java
@Secured("ROLE_CASE_APPROVER")
public void approveCase(long caseId) { ... }
```

Keterbatasan:

```text
- tidak sefleksibel SpEL
- tidak cocok untuk object-level authorization
- role prefix sering membingungkan
- cenderung coarse-grained
```

Masih berguna untuk simple coarse operation, tapi untuk seri ini kita anggap sebagai legacy/simple mode.

### 5.6 `@RolesAllowed`

`@RolesAllowed` berasal dari JSR-250/Jakarta style.

```java
@RolesAllowed("CASE_APPROVER")
public void approveCase(long caseId) { ... }
```

Berguna jika ingin portability dengan style enterprise Java, tetapi tetap coarse-grained.

Untuk authorization modern, annotation ini tidak cukup untuk:

```text
- tenant boundary
- object ownership
- workflow state
- maker-checker
- delegation
- ABAC/ReBAC
```

---

## 6. `@PreAuthorize` Dalam Praktik

### 6.1 Role check sederhana

```java
@PreAuthorize("hasRole('ADMIN')")
public void rebuildSearchIndex() {
    // admin operation
}
```

Ini boleh untuk operation yang memang administrative dan tidak bergantung resource.

Tapi jangan gunakan ini untuk semua hal.

### 6.2 Authority check

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approveCase(long caseId) {
    // still not enough for object-level authorization
}
```

Lebih baik daripada role, tetapi masih belum cukup jika ada object-level rule.

### 6.3 Object-level check

```java
@PreAuthorize("@caseAuthz.canApprove(authentication, #caseId)")
public void approveCase(long caseId) {
    // business logic
}
```

`caseAuthz` adalah Spring bean.

```java
@Component("caseAuthz")
public class CaseAuthorization {

    private final CaseRepository caseRepository;
    private final MembershipService membershipService;

    public CaseAuthorization(CaseRepository caseRepository,
                             MembershipService membershipService) {
        this.caseRepository = caseRepository;
        this.membershipService = membershipService;
    }

    public boolean canApprove(Authentication authentication, long caseId) {
        UserPrincipal user = (UserPrincipal) authentication.getPrincipal();

        CaseAuthorizationSnapshot caze = caseRepository.findAuthorizationSnapshot(caseId)
                .orElse(null);

        if (caze == null) {
            return false;
        }

        if (!membershipService.belongsToAgency(user.userId(), caze.agencyId())) {
            return false;
        }

        if (!user.hasAuthority("case.approve")) {
            return false;
        }

        if (!caze.status().equals(CaseStatus.PENDING_REVIEW)) {
            return false;
        }

        if (caze.submittedBy().equals(user.userId())) {
            return false;
        }

        return caze.assignedReviewer().equals(user.userId());
    }
}
```

Ini sudah lebih baik, tetapi masih ada kelemahan: boolean tidak menjelaskan alasan.

Kita bisa evolusikan:

```java
@Component("caseAuthz")
public class CaseAuthorization {

    public boolean canApprove(Authentication authentication, long caseId) {
        return evaluateApprove(authentication, caseId).allowed();
    }

    public AuthorizationDecisionDetail evaluateApprove(Authentication authentication, long caseId) {
        // return reason, evidence, policy id, etc.
    }
}
```

Spring expression tetap butuh boolean, tetapi internal service bisa menyimpan struktur keputusan yang lebih kaya untuk audit/test.

---

## 7. SpEL: Powerful, Tapi Jangan Jadikan Policy Language Utama

Spring Expression Language memungkinkan expression seperti:

```java
@PreAuthorize("hasAuthority('case.approve') and @caseAuthz.isAssignedReviewer(authentication, #caseId)")
```

Untuk rule kecil, ini nyaman.

Tapi expression bisa cepat menjadi buruk:

```java
@PreAuthorize("hasAuthority('case.approve') and @orgAuthz.inSameAgency(authentication, #caseId) and @caseAuthz.isAssignedReviewer(authentication, #caseId) and !@caseAuthz.isSubmitter(authentication, #caseId) and @caseAuthz.isInState(#caseId, 'PENDING_REVIEW') and @delegationAuthz.hasValidDelegation(authentication, #caseId)")
```

Masalahnya:

```text
- sulit dibaca
- sulit dites secara granular
- sulit diaudit
- sulit reuse
- raw string rentan typo
- refactor parameter/method bisa rusak diam-diam
- rule tersebar di banyak annotation
```

Lebih baik:

```java
@PreAuthorize("@caseAuthz.canApprove(authentication, #caseId)")
public void approveCase(long caseId) { ... }
```

Lalu kompleksitas dipindah ke Java code yang:

```text
- typed
- unit-testable
- observable
- versionable
- auditable
- bisa mengembalikan reason code
```

Rule:

```text
Gunakan SpEL sebagai wiring layer, bukan sebagai policy engine besar.
```

---

## 8. Parameter Name Binding dan Java Version Concern

Expression seperti ini:

```java
@PreAuthorize("@caseAuthz.canView(authentication, #caseId)")
public CaseDetail getCase(long caseId) { ... }
```

mengandalkan nama parameter `caseId` tersedia saat runtime.

Pada Java/Spring modern, sangat disarankan compile dengan:

```text
-parameters
```

Maven:

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <parameters>true</parameters>
    </configuration>
</plugin>
```

Gradle:

```groovy
tasks.withType(JavaCompile).configureEach {
    options.compilerArgs += ['-parameters']
}
```

Tanpa ini, Spring bisa gagal resolve `#caseId`, terutama pada versi framework modern.

Alternatif aman:

```java
@PreAuthorize("@caseAuthz.canView(authentication, #p0)")
public CaseDetail getCase(long caseId) { ... }
```

atau:

```java
@PreAuthorize("@caseAuthz.canView(authentication, #root.args[0])")
public CaseDetail getCase(long caseId) { ... }
```

Tapi `#p0` kurang readable.

Untuk codebase enterprise, lebih baik aktifkan `-parameters` dan jadikan ini standar build.

---

## 9. Method Security dan Proxy Trap

Spring method security biasanya berbasis proxy.

Artinya, security interceptor berjalan jika method dipanggil melalui proxy Spring.

### 9.1 Self-invocation problem

Contoh bug:

```java
@Service
public class CaseService {

    public void process(long caseId) {
        approve(caseId); // self-invocation, bypass proxy
    }

    @PreAuthorize("@caseAuthz.canApprove(authentication, #caseId)")
    public void approve(long caseId) {
        // protected operation
    }
}
```

`process` memanggil `approve` dari instance yang sama. Call tidak melewati proxy. Annotation bisa tidak dievaluasi.

Ini salah satu bug paling berbahaya di method security.

Solusi desain:

#### Opsi A — Pisahkan protected method ke bean lain

```java
@Service
public class CaseWorkflowService {

    private final CaseApprovalService approvalService;

    public CaseWorkflowService(CaseApprovalService approvalService) {
        this.approvalService = approvalService;
    }

    public void process(long caseId) {
        approvalService.approve(caseId); // goes through proxy
    }
}

@Service
public class CaseApprovalService {

    @PreAuthorize("@caseAuthz.canApprove(authentication, #caseId)")
    public void approve(long caseId) {
        // protected
    }
}
```

#### Opsi B — Authorization explicit di dalam method

```java
public void process(long caseId) {
    authorizationService.requireCanApprove(currentUser(), caseId);
    approveInternal(caseId);
}
```

Untuk domain yang sangat penting, opsi B sering lebih jelas.

#### Opsi C — Expose proxy/self injection

Kadang orang melakukan:

```java
@Autowired
private CaseService self;

public void process(long caseId) {
    self.approve(caseId);
}
```

Ini bisa bekerja, tetapi sering dianggap smell. Ia membuat bean bergantung pada proxy dirinya sendiri dan rawan cycle/configuration confusion.

Untuk sistem high-integrity, lebih baik pisahkan responsibility atau explicit authorization.

### 9.2 Final class/final method problem

Proxy berbasis subclass tidak bisa override final method.

Jika method final, method security bisa tidak bekerja tergantung proxy mechanism.

Buruk:

```java
@Service
public final class CaseService {

    @PreAuthorize("hasAuthority('case.approve')")
    public final void approve(long caseId) { ... }
}
```

Rule:

```text
Jangan jadikan service class/method yang diamankan sebagai final jika memakai proxy-based AOP.
```

Jika memakai Kotlin, ini lebih penting karena class final by default.

### 9.3 Private method tidak bisa diamankan sebagai boundary

```java
@PreAuthorize("hasAuthority('case.approve')")
private void approveInternal(long caseId) { ... }
```

Private method bukan proxy boundary. Jangan mengandalkan annotation di private method.

### 9.4 Interface vs implementation annotation

Jika annotation diletakkan di interface dan implementation, behavior bisa membingungkan tergantung proxy dan config.

Contoh:

```java
public interface CaseService {
    @PreAuthorize("hasAuthority('case.read')")
    CaseDetail getCase(long id);
}

@Service
public class CaseServiceImpl implements CaseService {
    public CaseDetail getCase(long id) { ... }
}
```

Ini bisa valid, tetapi standar tim harus jelas:

```text
- annotation di interface untuk API contract?
- atau annotation di implementation untuk runtime behavior?
```

Untuk large codebase, rekomendasi praktis:

```text
Letakkan annotation di implementation service, kecuali interface memang public contract lintas module dan tim punya standar konsisten.
```

---

## 10. Transaction Ordering dan Authorization

Authorization dan transaction punya hubungan yang tricky.

Pertanyaan:

```text
Apakah authorization harus berjalan sebelum transaction dimulai, atau di dalam transaction?
```

Jawaban: tergantung rule.

### 10.1 Authorization sebelum transaction

Kelebihan:

```text
- deny cepat
- tidak membuka DB transaction jika tidak perlu
- cocok untuk simple authority check
```

Kelemahan:

```text
- kalau authorization butuh load resource, tetap butuh DB access
- snapshot resource bisa berubah sebelum mutation
- TOCTOU lebih mungkin
```

### 10.2 Authorization di dalam transaction

Kelebihan:

```text
- bisa load resource dan mutate dalam boundary yang sama
- bisa lock row jika perlu
- mengurangi TOCTOU
```

Kelemahan:

```text
- transaction dibuka bahkan untuk denied request
- perlu hati-hati jangan melakukan side effect sebelum decision
```

Contoh explicit style untuk mutation penting:

```java
@Transactional
public void approve(long caseId) {
    Case caze = caseRepository.findByIdForUpdate(caseId)
            .orElseThrow(CaseNotFoundException::new);

    authorizationService.requireCanApprove(currentUser(), caze);

    caze.approve(currentUser().id());
    caseRepository.save(caze);
}
```

Ini sering lebih aman daripada annotation yang load resource terpisah.

### 10.3 Annotation style dengan resource load terpisah

```java
@PreAuthorize("@caseAuthz.canApprove(authentication, #caseId)")
@Transactional
public void approve(long caseId) {
    Case caze = caseRepository.findById(caseId).orElseThrow();
    caze.approve();
}
```

Risiko:

```text
- case loaded once in authz, once in service
- state bisa berubah antara check dan mutation
- authz snapshot dan mutation snapshot bisa tidak sama
```

Untuk operation low-risk, ini mungkin acceptable.

Untuk approval/payment/legal/regulatory transition, gunakan explicit in-transaction authorization.

---

## 11. TOCTOU: Time-of-Check to Time-of-Use

TOCTOU terjadi ketika authorization dicek pada satu waktu, tetapi resource digunakan pada waktu lain dengan kondisi yang sudah berubah.

Contoh:

```text
T1: User A authorized to approve case 100 because assigned reviewer = A.
T2: Supervisor reassigns case 100 to User B.
T3: User A's approve method continues and approves case 100.
```

Jika authorization dan mutation tidak memakai snapshot/lock/version yang benar, bug terjadi.

Mitigasi:

```text
- optimistic locking with version check
- pessimistic lock for critical transition
- authorization inside transaction
- state transition guard in aggregate
- conditional update
- compare-and-set style SQL
```

Contoh conditional update:

```java
@Modifying
@Query("""
       update CaseEntity c
          set c.status = :approved,
              c.approvedBy = :userId
        where c.id = :caseId
          and c.status = :pendingReview
          and c.assignedReviewerId = :userId
          and c.submittedBy <> :userId
       """)
int approveIfAuthorized(long caseId,
                        long userId,
                        CaseStatus pendingReview,
                        CaseStatus approved);
```

Kemudian:

```java
int updated = repository.approveIfAuthorized(caseId, userId, PENDING_REVIEW, APPROVED);
if (updated == 0) {
    throw new AccessDeniedException("Not allowed or stale state");
}
```

Ini menggabungkan authorization condition dan mutation secara atomik.

Namun jangan terlalu banyak business rule disembunyikan di SQL tanpa model yang jelas. Untuk critical path, kombinasikan:

```text
- domain-level rule for readability
- DB conditional guard for atomicity
```

---

## 12. Custom PermissionEvaluator

Spring menyediakan `PermissionEvaluator` untuk expression seperti:

```java
@PreAuthorize("hasPermission(#caseId, 'Case', 'approve')")
public void approve(long caseId) { ... }
```

Interface klasik:

```java
public interface PermissionEvaluator {
    boolean hasPermission(Authentication authentication,
                          Object targetDomainObject,
                          Object permission);

    boolean hasPermission(Authentication authentication,
                          Serializable targetId,
                          String targetType,
                          Object permission);
}
```

Contoh implementasi:

```java
@Component
public class DomainPermissionEvaluator implements PermissionEvaluator {

    private final CaseAuthorization caseAuthorization;

    public DomainPermissionEvaluator(CaseAuthorization caseAuthorization) {
        this.caseAuthorization = caseAuthorization;
    }

    @Override
    public boolean hasPermission(Authentication authentication,
                                 Object targetDomainObject,
                                 Object permission) {
        if (targetDomainObject instanceof CaseDetail caseDetail) {
            return switch (String.valueOf(permission)) {
                case "view" -> caseAuthorization.canView(authentication, caseDetail);
                case "approve" -> caseAuthorization.canApprove(authentication, caseDetail.id());
                default -> false;
            };
        }
        return false;
    }

    @Override
    public boolean hasPermission(Authentication authentication,
                                 Serializable targetId,
                                 String targetType,
                                 Object permission) {
        if ("Case".equals(targetType)) {
            long caseId = Long.parseLong(targetId.toString());
            return switch (String.valueOf(permission)) {
                case "view" -> caseAuthorization.canView(authentication, caseId);
                case "approve" -> caseAuthorization.canApprove(authentication, caseId);
                default -> false;
            };
        }
        return false;
    }
}
```

Usage:

```java
@PreAuthorize("hasPermission(#caseId, 'Case', 'approve')")
public void approve(long caseId) { ... }
```

Kelebihan:

```text
- expression lebih standard
- cocok untuk domain object permission
- dapat reuse pattern `hasPermission`
```

Kekurangan:

```text
- raw string target type dan permission
- bisa menjadi god evaluator
- boolean-only
- sulit menyampaikan reason detail
- target type typo tidak terdeteksi compile-time
```

Rekomendasi:

```text
Gunakan PermissionEvaluator jika codebase Spring Security-heavy dan butuh pattern standar.
Untuk sistem authorization kompleks, jadikan evaluator adapter tipis ke AuthorizationService typed.
```

Contoh adapter yang lebih baik:

```java
@Override
public boolean hasPermission(Authentication authentication,
                             Serializable targetId,
                             String targetType,
                             Object permission) {
    AuthorizationRequest request = AuthorizationRequest.builder()
            .subject(subjectMapper.from(authentication))
            .resource(ResourceRef.of(targetType, String.valueOf(targetId)))
            .action(Action.of(String.valueOf(permission)))
            .context(RequestAuthorizationContext.current())
            .build();

    return authorizationService.decide(request).allowed();
}
```

---

## 13. Custom Security Expression Root

Untuk expression DSL internal, bisa membuat custom expression root.

Contoh desired usage:

```java
@PreAuthorize("canApproveCase(#caseId)")
public void approve(long caseId) { ... }
```

Alih-alih:

```java
@PreAuthorize("@caseAuthz.canApprove(authentication, #caseId)")
```

Kelebihan:

```text
- expression lebih bersih
- vocabulary authorization bisa distandardisasi
- mengurangi bean-name coupling di annotation
```

Kekurangan:

```text
- konfigurasi lebih advanced
- bisa menyembunyikan dependency
- tetap string-based
- tetap proxy/SpEL ecosystem
```

Untuk enterprise codebase besar, custom expression root dapat berguna jika ada governance kuat.

Tapi jangan jadikan expression root sebagai tempat business rule besar. Ia sebaiknya adapter ke service typed.

---

## 14. Custom AuthorizationManager Untuk Method Security

Spring Security modern bergerak ke model `AuthorizationManager`.

Konsepnya:

```text
AuthorizationManager<T> menentukan apakah Authentication punya akses terhadap object T.
```

Untuk method security, object yang dievaluasi biasanya method invocation atau return object.

Mental model:

```text
Annotation-based method security:
  method annotation -> interceptor -> authorization manager -> decision
```

Kapan custom AuthorizationManager berguna?

```text
- ingin mengurangi SpEL
- ingin policy lebih typed
- ingin reuse decision pipeline
- ingin centralize audit/evidence
- ingin integrate dengan internal/external PDP
```

Contoh conceptual manager:

```java
public final class CaseApproveAuthorizationManager
        implements AuthorizationManager<MethodInvocation> {

    private final AuthorizationService authorizationService;

    public CaseApproveAuthorizationManager(AuthorizationService authorizationService) {
        this.authorizationService = authorizationService;
    }

    @Override
    public AuthorizationDecision check(Supplier<Authentication> authentication,
                                       MethodInvocation invocation) {
        Object[] args = invocation.getArguments();
        long caseId = (Long) args[0];

        boolean allowed = authorizationService.canApproveCase(authentication.get(), caseId);
        return new AuthorizationDecision(allowed);
    }
}
```

Dalam praktik, konfigurasi custom method interceptor lebih advanced daripada sekadar `@PreAuthorize`. Karena itu untuk kebanyakan aplikasi, pattern paling maintainable adalah:

```java
@PreAuthorize("@caseAuthz.canApprove(authentication, #caseId)")
```

sementara `caseAuthz` memanggil typed `AuthorizationService`.

Gunakan custom method `AuthorizationManager` jika framework/security team di organisasi memang mengelola platform authorization bersama.

---

## 15. `@PostAuthorize` Untuk Return Object Security

Kasus umum:

```java
@PostAuthorize("returnObject.ownerId == authentication.principal.userId")
public Document getDocument(long documentId) {
    return documentRepository.findById(documentId).orElseThrow();
}
```

Ini pendek, tapi raw property access di SpEL bisa rapuh.

Lebih baik:

```java
@PostAuthorize("@documentAuthz.canView(authentication, returnObject)")
public DocumentDetail getDocument(long documentId) {
    return documentRepository.findDetail(documentId).orElseThrow();
}
```

Tetapi perhatikan:

```text
- object sudah diload
- lazy property access bisa terjadi di SpEL
- jika session/transaction sudah tertutup, lazy loading bisa error
- jika return object mengandung sensitive data, data sempat ada di memory aplikasi
```

Untuk read single object, biasanya acceptable.

Untuk high-security data, lebih baik load authorization snapshot dulu atau query dengan scope.

---

## 16. Filtering: Kenapa `@PostFilter` Jarang Cocok Untuk Sistem Besar

Contoh buruk:

```java
@PostFilter("@caseAuthz.canView(authentication, filterObject)")
public Page<CaseSummary> search(SearchCriteria criteria, Pageable pageable) {
    return repository.search(criteria, pageable);
}
```

Masalah:

```text
Page adalah wrapper, bukan sekadar list.
@PostFilter tidak memperbaiki totalElements, totalPages, offset, sort, aggregation.
```

Bahkan jika return `List`, tetap ada masalah:

```text
- DB sudah membaca unauthorized rows
- memory meningkat
- log SQL/report bisa merekam unauthorized data
- timing side-channel mungkin muncul
```

Pattern yang benar:

```java
public Page<CaseSummary> search(SearchCriteria criteria, Pageable pageable) {
    UserContext user = currentUser();
    CaseVisibility visibility = authorizationService.caseVisibility(user);
    return repository.search(criteria, visibility, pageable);
}
```

Repository:

```java
public Page<CaseSummary> search(SearchCriteria criteria,
                                CaseVisibility visibility,
                                Pageable pageable) {
    Specification<CaseEntity> spec = Specification
            .where(CaseSpecs.matches(criteria))
            .and(CaseSpecs.visibleTo(visibility));

    return caseRepository.findAll(spec, pageable).map(mapper::toSummary);
}
```

Rule:

```text
Method filtering is not query authorization.
```

---

## 17. Service-Level Authorization Pattern Options

Ada beberapa pola umum.

### 17.1 Annotation-only pattern

```java
@PreAuthorize("hasAuthority('case.approve')")
public void approve(long caseId) { ... }
```

Cocok untuk:

```text
- simple admin operation
- coarse permission
- low object sensitivity
```

Tidak cocok untuk:

```text
- object-level authorization
- workflow state
- tenant boundary
- maker-checker
```

### 17.2 Annotation delegates to authz bean

```java
@PreAuthorize("@caseAuthz.canApprove(authentication, #caseId)")
public void approve(long caseId) { ... }
```

Cocok untuk mayoritas aplikasi Spring.

Kelebihan:

```text
- annotation tetap ringkas
- logic pindah ke Java typed service
- mudah unit test
- reusable
```

Kekurangan:

```text
- boolean-only di annotation
- masih ada proxy trap
- possible duplicate resource loading
```

### 17.3 Explicit authorization inside service

```java
@Transactional
public void approve(long caseId) {
    Case caze = caseRepository.findByIdForUpdate(caseId).orElseThrow();
    authorizationService.requireCanApprove(currentUser(), caze);
    caze.approve(currentUser().id());
}
```

Cocok untuk:

```text
- critical mutation
- workflow state transition
- TOCTOU-sensitive operation
- rich audit/evidence requirement
```

Kelebihan:

```text
- transaction-aware
- domain-aware
- easier rich audit
- explicit control over resource loading
```

Kekurangan:

```text
- tidak terlihat dari annotation scan
- perlu discipline/convention
- bisa lupa dipanggil jika tidak distandardisasi
```

### 17.4 Domain aggregate guard

```java
public final class Case {

    public void approve(Actor actor, AuthorizationDecision decision) {
        if (!decision.allowed()) {
            throw new AccessDeniedException(decision.reasonCode());
        }
        if (status != PENDING_REVIEW) {
            throw new InvalidCaseStateException();
        }
        this.status = APPROVED;
        this.approvedBy = actor.id();
    }
}
```

Atau domain method mengevaluasi invariant:

```java
public void approve(Actor actor) {
    if (!assignedReviewerId.equals(actor.id())) {
        throw new AccessDeniedException("NOT_ASSIGNED_REVIEWER");
    }
    if (submittedBy.equals(actor.id())) {
        throw new AccessDeniedException("MAKER_CHECKER_VIOLATION");
    }
    // transition
}
```

Kelebihan:

```text
- invariant dekat domain
- sulit bypass jika semua mutation lewat aggregate
```

Kekurangan:

```text
- domain object bisa terlalu tahu security infrastructure
- perlu pisahkan pure domain invariant vs external policy
```

Rekomendasi:

```text
Gunakan domain guard untuk invariant yang benar-benar intrinsic.
Gunakan AuthorizationService untuk policy yang berasal dari user/org/permission/context eksternal.
```

---

## 18. Jangan Campur Business Validation dan Authorization Secara Kabur

Contoh:

```java
if (case.status() != PENDING_REVIEW) {
    throw new AccessDeniedException("Cannot approve");
}
```

Apakah ini authorization atau business validation?

Tergantung language domain.

Jika rule-nya:

```text
Tidak ada siapa pun yang boleh approve case yang bukan PENDING_REVIEW.
```

Ini state invariant/business rule.

Jika rule-nya:

```text
Reviewer boleh approve hanya jika case PENDING_REVIEW.
```

Ini authorization condition yang bergantung action+role+state.

Dalam practice, keduanya sering overlap. Yang penting adalah reason code dan audit classification jelas.

Contoh lebih baik:

```java
AuthorizationDecision decision = caseApprovalPolicy.evaluate(user, caze);
if (!decision.allowed()) {
    auditAuthorizationDenied(decision);
    throw new AccessDeniedException(decision.safeMessage());
}

caze.approve(user.id()); // aggregate still validates state invariant
```

Dengan begitu:

```text
- policy memutuskan apakah actor boleh mencoba action
- aggregate memastikan transition tetap valid
```

---

## 19. Designing Authorization Decision Untuk Method Security

Spring annotation butuh boolean, tetapi internal model sebaiknya lebih kaya.

```java
public final class PolicyDecision {

    private final boolean allowed;
    private final String reasonCode;
    private final String policyId;
    private final Map<String, Object> evidence;

    private PolicyDecision(boolean allowed,
                           String reasonCode,
                           String policyId,
                           Map<String, Object> evidence) {
        this.allowed = allowed;
        this.reasonCode = reasonCode;
        this.policyId = policyId;
        this.evidence = Map.copyOf(evidence);
    }

    public boolean allowed() {
        return allowed;
    }

    public String reasonCode() {
        return reasonCode;
    }

    public String policyId() {
        return policyId;
    }

    public Map<String, Object> evidence() {
        return evidence;
    }

    public static PolicyDecision allow(String policyId) {
        return new PolicyDecision(true, "ALLOW", policyId, Map.of());
    }

    public static PolicyDecision deny(String reasonCode, String policyId) {
        return new PolicyDecision(false, reasonCode, policyId, Map.of());
    }
}
```

Java 17+ bisa menggunakan record:

```java
public record PolicyDecision(
        boolean allowed,
        String reasonCode,
        String policyId,
        Map<String, Object> evidence
) {
    public static PolicyDecision allow(String policyId) {
        return new PolicyDecision(true, "ALLOW", policyId, Map.of());
    }

    public static PolicyDecision deny(String reasonCode, String policyId) {
        return new PolicyDecision(false, reasonCode, policyId, Map.of());
    }
}
```

Adapter ke annotation:

```java
@Component("caseAuthz")
public class CaseAuthorizationExpression {

    private final CaseAuthorizationService service;

    public boolean canApprove(Authentication authentication, long caseId) {
        return service.evaluateApprove(authentication, caseId).allowed();
    }
}
```

Explicit service:

```java
public void requireAllowed(PolicyDecision decision) {
    if (!decision.allowed()) {
        throw new AccessDeniedException(decision.reasonCode());
    }
}
```

---

## 20. Current User Access: Jangan Sebar `SecurityContextHolder` Sembarangan

Buruk:

```java
public void approve(long caseId) {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    // business logic
}
```

Jika ini tersebar di banyak service:

```text
- sulit test
- sulit support non-HTTP caller
- sulit support system actor
- sulit support delegation
- sulit reason about boundaries
```

Lebih baik buat abstraction:

```java
public interface CurrentActorProvider {
    Actor currentActor();
}
```

Implementasi Spring:

```java
@Component
public class SpringSecurityCurrentActorProvider implements CurrentActorProvider {

    @Override
    public Actor currentActor() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new AuthenticationCredentialsNotFoundException("No authenticated actor");
        }
        return ActorMapper.from(authentication);
    }
}
```

Service:

```java
@Transactional
public void approve(long caseId) {
    Actor actor = currentActorProvider.currentActor();
    Case caze = caseRepository.findByIdForUpdate(caseId).orElseThrow();
    authorizationService.requireCanApprove(actor, caze);
    caze.approve(actor.id());
}
```

Ini lebih testable dan lebih siap untuk:

```text
- system actor
- batch actor
- delegated actor
- impersonated actor
- service account
```

---

## 21. Method Security Untuk Read Operation

### 21.1 Single resource read

Pattern annotation:

```java
@PreAuthorize("@caseAuthz.canView(authentication, #caseId)")
public CaseDetail getCase(long caseId) {
    return caseRepository.findDetail(caseId).orElseThrow();
}
```

Atau query-scoped:

```java
public CaseDetail getCase(long caseId) {
    Actor actor = currentActorProvider.currentActor();
    return caseRepository.findDetailVisibleTo(caseId, actor)
            .orElseThrow(() -> notFoundOrDenied(caseId));
}
```

Pertanyaan penting:

```text
Jika user tidak boleh melihat case, return 403 atau 404?
```

Dalam object-sensitive system, 404 dapat digunakan untuk menyembunyikan existence. Tapi audit internal tetap harus mencatat denial.

### 21.2 Search/list read

Jangan pakai `@PostFilter` untuk search besar.

Gunakan visibility scope:

```java
public Page<CaseSummary> search(CaseSearchCriteria criteria, Pageable pageable) {
    Actor actor = currentActorProvider.currentActor();
    CaseReadScope scope = authorizationService.readScopeForCases(actor);
    return caseSearchRepository.search(criteria, scope, pageable);
}
```

`CaseReadScope` bisa berupa:

```java
public final class CaseReadScope {
    private final Set<Long> agencyIds;
    private final Set<Long> teamIds;
    private final boolean includeAssignedOnly;
    private final boolean includeConfidential;
}
```

Kemudian diterjemahkan ke query predicate.

---

## 22. Method Security Untuk Write Operation

Write operation perlu lebih hati-hati.

### 22.1 Simple command

```java
@PreAuthorize("@caseAuthz.canCreate(authentication)")
public long createCase(CreateCaseCommand command) {
    // create
}
```

### 22.2 Object mutation

Lebih aman explicit:

```java
@Transactional
public void updateCase(long caseId, UpdateCaseCommand command) {
    Actor actor = currentActorProvider.currentActor();
    Case caze = caseRepository.findByIdForUpdate(caseId).orElseThrow();

    authorizationService.requireCanUpdate(actor, caze, command);

    caze.update(command, actor.id());
}
```

Kenapa command ikut authorization?

Karena update field tertentu bisa lebih sensitif.

```text
User boleh update description, tapi tidak boleh update riskLevel.
User boleh edit draft, tapi tidak boleh change assigned officer.
User boleh submit, tapi tidak boleh backdate effective date.
```

Authorization bukan hanya resource-level, tapi juga field/action-level.

### 22.3 Bulk command

Jangan silent filter.

```java
@Transactional
public BulkApprovalResult bulkApprove(List<Long> caseIds) {
    Actor actor = currentActorProvider.currentActor();
    List<Case> cases = caseRepository.findAllByIdForUpdate(caseIds);

    BulkAuthorizationDecision decision = authorizationService.evaluateBulkApprove(actor, cases);

    if (decision.hasDenied()) {
        audit.denied(decision);
        throw new BulkAuthorizationException(decision.safeSummary());
    }

    cases.forEach(c -> c.approve(actor.id()));
    return BulkApprovalResult.success(cases.size());
}
```

Untuk partial success, desain explicit:

```java
public BulkApprovalResult bulkApprovePartial(List<Long> caseIds) {
    // returns per-item allowed/denied reason
}
```

Jangan biarkan `@PreFilter` membuat behavior partial tanpa kontrak API.

---

## 23. Method Security Untuk Async, Batch, dan Messaging

Method security bergantung pada `SecurityContext`.

Dalam async thread, scheduled job, batch, atau message consumer, context bisa tidak ada.

### 23.1 Async method

```java
@Async
@PreAuthorize("hasAuthority('case.export')")
public CompletableFuture<FileRef> exportCases(...) { ... }
```

Pertanyaan:

```text
SecurityContext dari request thread ikut propagate atau tidak?
```

Jika tidak, authorization gagal atau memakai anonymous context.

Untuk async, desain lebih eksplisit:

```java
public ExportJobId requestExport(ExportCommand command) {
    Actor actor = currentActorProvider.currentActor();
    authorizationService.requireCanRequestExport(actor, command);
    return exportJobService.enqueue(actor.toJobActor(), command);
}
```

Job menyimpan actor snapshot:

```java
public record JobActor(
        String actorId,
        Set<String> authorities,
        String agencyId,
        Instant requestedAt
) {}
```

Kemudian worker menjalankan berdasarkan authorization snapshot atau re-evaluate policy sesuai requirement.

### 23.2 Scheduled job

Scheduled job tidak punya human user.

Jangan fake admin user sembarangan.

Gunakan system actor:

```java
Actor system = Actor.system("case-auto-closure-job");
authorizationService.requireSystemCanCloseExpiredCases(system);
```

System actor harus punya scope jelas.

### 23.3 Message consumer

Message bisa membawa command dari user atau service.

```text
- Apakah authorization sudah dilakukan sebelum publish?
- Apakah consumer harus re-authorize?
- Apakah message membawa actor snapshot?
- Apakah permission bisa dicabut sebelum message diproses?
```

Untuk high-risk command, consumer sebaiknya re-authorize dengan current state.

---

## 24. Method Security dan Reactive Stack Catatan Singkat

Seri ini fokus Servlet stack pada Part 13/14, tetapi perlu catatan.

Pada reactive stack, security context tidak berbasis thread-local klasik seperti `SecurityContextHolder` imperative. Ia berjalan melalui Reactor context.

Implikasi:

```text
- jangan ambil current user via ThreadLocal sembarangan
- method security reactive punya mekanisme sendiri
- return type harus reactive agar decision bisa async/reactive
```

Untuk aplikasi Java enterprise imperative/Spring MVC, bagian ini cukup sebagai awareness. Deep reactive authorization tidak kita perluas di sini agar tidak mengulang seri reactive sebelumnya.

---

## 25. Method Security Testing

Testing method security harus memastikan annotation/proxy benar-benar aktif.

Ada dua jenis test:

```text
1. Unit test policy/authz service.
2. Integration test Spring method security proxy.
```

### 25.1 Unit test authorization service

```java
class CaseAuthorizationServiceTest {

    @Test
    void reviewerAssignedToPendingCaseCanApprove() {
        Actor reviewer = actorWith("case.approve", agency(10), userId(100));
        CaseAuthorizationSnapshot caze = pendingCase()
                .agencyId(10)
                .assignedReviewer(100)
                .submittedBy(200)
                .build();

        PolicyDecision decision = service.evaluateApprove(reviewer, caze);

        assertThat(decision.allowed()).isTrue();
    }

    @Test
    void submitterCannotApproveOwnCase() {
        Actor reviewer = actorWith("case.approve", agency(10), userId(100));
        CaseAuthorizationSnapshot caze = pendingCase()
                .agencyId(10)
                .assignedReviewer(100)
                .submittedBy(100)
                .build();

        PolicyDecision decision = service.evaluateApprove(reviewer, caze);

        assertThat(decision.allowed()).isFalse();
        assertThat(decision.reasonCode()).isEqualTo("MAKER_CHECKER_VIOLATION");
    }
}
```

Unit test harus banyak dan cepat.

### 25.2 Spring method security integration test

```java
@SpringBootTest
class CaseServiceMethodSecurityTest {

    @Autowired
    CaseService caseService;

    @Test
    @WithMockUser(authorities = "case.approve")
    void allowedUserCanInvokeApprove() {
        caseService.approve(100L);
    }

    @Test
    @WithMockUser(authorities = "case.read")
    void userWithoutApproveAuthorityIsDenied() {
        assertThatThrownBy(() -> caseService.approve(100L))
                .isInstanceOf(AccessDeniedException.class);
    }
}
```

Test ini memastikan:

```text
- bean diproxy
- annotation aktif
- expression valid
- denied menghasilkan exception
```

### 25.3 Test self-invocation

Jika ada method internal yang memanggil protected method, buat test khusus.

```java
@Test
@WithMockUser(authorities = "case.read")
void processMustNotBypassApproveAuthorization() {
    assertThatThrownBy(() -> caseService.process(100L))
            .isInstanceOf(AccessDeniedException.class);
}
```

Jika test ini gagal karena `process` berhasil, berarti ada bypass.

### 25.4 Test parameter binding

```java
@Test
@WithMockUser(authorities = "case.approve")
void expressionCanResolveCaseIdParameter() {
    caseService.approve(100L);
    verify(caseAuthz).canApprove(any(), eq(100L));
}
```

Ini penting setelah upgrade Spring/Java/build.

### 25.5 Negative matrix

Untuk operation penting, test matrix:

```text
- no authentication
- authenticated no authority
- authority but wrong agency
- authority but not assigned
- authority but wrong state
- authority but submitter same as approver
- delegated but expired
- delegated valid
- admin override allowed/denied according policy
```

---

## 26. Observability dan Audit Untuk Method Denial

Method security default akan throw `AccessDeniedException`, tetapi enterprise system butuh lebih.

Minimal log internal:

```text
- correlation id
- actor id
- action
- resource id/type
- decision allow/deny
- reason code
- policy id/version
- source layer: method-security/service-policy/domain-guard
```

Jangan log data sensitif berlebihan.

Pattern:

```java
public void requireCanApprove(Actor actor, Case caze) {
    PolicyDecision decision = evaluateApprove(actor, caze);
    audit.record(actor, Action.CASE_APPROVE, caze.ref(), decision);
    if (!decision.allowed()) {
        throw new AccessDeniedException(decision.reasonCode());
    }
}
```

Untuk annotation mode, audit bisa diletakkan dalam authz bean:

```java
public boolean canApprove(Authentication authentication, long caseId) {
    PolicyDecision decision = service.evaluateApprove(authentication, caseId);
    audit.record(decision);
    return decision.allowed();
}
```

Namun hati-hati:

```text
Jika expression dievaluasi beberapa kali, audit bisa duplikat.
```

Untuk sistem yang butuh audit kuat, explicit authorization service lebih mudah dikontrol.

---

## 27. Exception Mapping: 403, 404, dan Business Denial

Method security denial biasanya menjadi `AccessDeniedException`.

Di web layer, ini sering dipetakan ke 403.

Namun service bisa juga dipakai non-web caller.

Pattern exception:

```java
public class AuthorizationDeniedException extends RuntimeException {
    private final String reasonCode;
    private final boolean hideResourceExistence;
}
```

Mapping:

```text
- unauthenticated -> 401
- authenticated but not allowed -> 403
- hidden object policy -> 404 externally, deny internally
- business invalid state -> 409 or 422 depending API contract
```

Jangan selalu menyamakan invalid state dengan access denied.

Contoh:

```text
Case already approved.
```

Itu mungkin business conflict, bukan authorization denial.

Tapi:

```text
User not assigned reviewer.
```

Itu authorization denial.

---

## 28. Migration Dari Annotation-heavy Security ke Policy Service

Banyak codebase mulai dari:

```java
@PreAuthorize("hasRole('ADMIN') or hasRole('CASE_MANAGER') or hasAuthority('case.approve')")
```

Lalu tumbuh menjadi:

```java
@PreAuthorize("(hasRole('ADMIN') or hasAuthority('case.approve')) and @org.check(authentication, #caseId) and @state.check(#caseId, 'PENDING') and !@makerChecker.same(authentication, #caseId)")
```

Migration bertahap:

### Step 1 — Wrap expression ke bean method

```java
@PreAuthorize("@caseAuthz.canApprove(authentication, #caseId)")
```

### Step 2 — Buat decision object internal

```java
PolicyDecision evaluateApprove(Actor actor, long caseId)
```

### Step 3 — Unit test policy service

Test semua matrix rule.

### Step 4 — Tambahkan audit reason code

```text
ALLOW
DENY_MISSING_PERMISSION
DENY_WRONG_AGENCY
DENY_NOT_ASSIGNED
DENY_INVALID_STATE
DENY_MAKER_CHECKER
```

### Step 5 — Untuk mutation kritikal, pindahkan ke explicit in-transaction authorization

```java
@Transactional
public void approve(long caseId) {
    Case caze = loadForUpdate(caseId);
    authorizationService.requireCanApprove(actor, caze);
    caze.approve(actor.id());
}
```

### Step 6 — Jadikan annotation coarse entry guard saja bila perlu

```java
@PreAuthorize("hasAuthority('case.approve')")
@Transactional
public void approve(long caseId) {
    // rich explicit authz inside
}
```

Ini mengurangi request tanpa authority sebelum DB transaction, tetapi rich check tetap di service.

---

## 29. Java 8–25 Design Notes

### Java 8

Gunakan class biasa:

```java
public final class AuthorizationRequest {
    private final Subject subject;
    private final Action action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    // constructor, getters
}
```

Gunakan `Optional`, immutable collections manual, dan builder jika perlu.

### Java 11

Tidak banyak perubahan langsung untuk method security, tetapi runtime dan dependency modern lebih stabil.

### Java 17

Spring Framework 6/Spring Security 6 baseline Java 17. Bisa gunakan:

```text
- records
- sealed classes
- pattern matching instanceof
- switch expression
```

Contoh:

```java
public sealed interface ResourceRef permits CaseRef, DocumentRef, ReportRef {}
public record CaseRef(long id) implements ResourceRef {}
```

### Java 21

Virtual threads tidak mengubah semantic method security secara otomatis.

Hati-hati dengan ThreadLocal context dan async boundary.

Spring Security imperative masih punya model `SecurityContextHolder`. Pastikan context propagation dipahami jika menggunakan executor/virtual thread/custom async.

### Java 25

Authorization design tetap sama secara prinsip. Gunakan fitur bahasa/runtime baru hanya jika meningkatkan clarity, bukan karena novelty.

Top-level rule:

```text
Authorization correctness lebih penting daripada menggunakan fitur Java terbaru.
```

---

## 30. Anti-Patterns

### 30.1 `@PreAuthorize("hasRole('ADMIN')")` everywhere

Menyebabkan admin superpower dan role explosion.

### 30.2 Complex SpEL as policy engine

Policy menjadi string panjang yang sulit dites.

### 30.3 Method security hanya di controller

Controller bukan service method security. Itu request/controller authorization.

### 30.4 Self-invocation bypass

Protected method dipanggil dari class yang sama.

### 30.5 `@PostFilter` untuk search/report besar

Merusak pagination, performance, dan auditability.

### 30.6 `@PostAuthorize` untuk mutation

Side effect sudah terjadi sebelum denial.

### 30.7 Boolean-only authorization service

Tidak ada reason, tidak ada evidence, sulit audit.

### 30.8 Trusting method argument blindly

```java
@PreAuthorize("#command.userId == authentication.principal.userId")
```

Jika `command.userId` datang dari client, hati-hati. Client bisa memalsukan field.

### 30.9 Annotation inconsistency

Sebagian method pakai annotation, sebagian explicit, tanpa rule jelas.

### 30.10 No integration test for proxy

Unit test policy lulus, tetapi annotation tidak aktif di runtime.

---

## 31. Production Checklist

Gunakan checklist ini untuk review method security.

### 31.1 Placement

```text
[ ] Operation sensitif punya authorization di service/domain, bukan hanya controller.
[ ] Non-HTTP caller tidak bisa bypass authorization.
[ ] Internal API/job/message path dipertimbangkan.
```

### 31.2 Annotation correctness

```text
[ ] `@EnableMethodSecurity` aktif.
[ ] Service bean benar-benar Spring-managed.
[ ] Protected method public/proxy-invoked.
[ ] Tidak ada self-invocation bypass.
[ ] Tidak ada final class/method yang mematahkan proxy.
[ ] Parameter binding aman, build memakai `-parameters` jika pakai nama parameter.
```

### 31.3 Policy quality

```text
[ ] SpEL pendek dan delegasi ke typed authz service.
[ ] Tidak ada policy kompleks tersebar sebagai string.
[ ] Authorization service menghasilkan reason code/evidence untuk rule penting.
[ ] Deny-by-default diterapkan.
```

### 31.4 Data correctness

```text
[ ] List/search/report memakai query scoping, bukan post-filter besar.
[ ] Pagination/count tidak bocor.
[ ] Export/download punya object/data-level authorization.
[ ] Tenant boundary enforced di query/cache.
```

### 31.5 Mutation safety

```text
[ ] Critical mutation authorize inside transaction atau atomic conditional update.
[ ] TOCTOU dipertimbangkan.
[ ] Side effect eksternal tidak terjadi sebelum authorization.
[ ] Bulk operation punya explicit partial/full failure semantics.
```

### 31.6 Testing

```text
[ ] Unit test policy matrix.
[ ] Integration test method security proxy.
[ ] Negative tests lebih banyak dari happy path.
[ ] Self-invocation/bypass path diuji.
[ ] Parameter binding diuji setelah upgrade.
```

### 31.7 Audit/ops

```text
[ ] Denial reason internal tercatat.
[ ] Sensitive data tidak bocor di error/log.
[ ] Correlation id tersedia.
[ ] Policy version/reason code tersedia untuk operation kritikal.
```

---

## 32. Decision Framework: Annotation atau Explicit Authorization?

Gunakan tabel ini.

| Situation | Recommended Pattern |
|---|---|
| Simple admin operation | `@PreAuthorize("hasAuthority(...)")` |
| Simple service read by authority | `@PreAuthorize` authority check |
| Single object read | `@PreAuthorize` delegated authz bean or query-scoped read |
| Large list/search/report | Query scoping, not `@PostFilter` |
| Critical workflow mutation | Explicit in-transaction authorization |
| Bulk operation | Explicit bulk decision model |
| External policy engine | Authz service adapter; annotation only as thin layer |
| Need rich audit/evidence | Explicit `AuthorizationService` |
| Multi-entry-point service | Service-level guard required |
| Heavy domain invariant | Domain guard + authz service |

---

## 33. Example: Case Approval Full Design

### 33.1 Controller

```java
@RestController
@RequestMapping("/cases")
public class CaseApprovalController {

    private final CaseApprovalService approvalService;

    public CaseApprovalController(CaseApprovalService approvalService) {
        this.approvalService = approvalService;
    }

    @PostMapping("/{caseId}/approve")
    public ResponseEntity<Void> approve(@PathVariable long caseId,
                                        @RequestBody ApproveCaseRequest request) {
        approvalService.approve(caseId, request.toCommand());
        return ResponseEntity.noContent().build();
    }
}
```

### 33.2 Service with coarse method guard + rich internal authorization

```java
@Service
public class CaseApprovalService {

    private final CurrentActorProvider currentActorProvider;
    private final CaseRepository caseRepository;
    private final CaseApprovalAuthorization authorization;

    public CaseApprovalService(CurrentActorProvider currentActorProvider,
                               CaseRepository caseRepository,
                               CaseApprovalAuthorization authorization) {
        this.currentActorProvider = currentActorProvider;
        this.caseRepository = caseRepository;
        this.authorization = authorization;
    }

    @PreAuthorize("hasAuthority('case.approve')")
    @Transactional
    public void approve(long caseId, ApproveCaseCommand command) {
        Actor actor = currentActorProvider.currentActor();

        Case caze = caseRepository.findByIdForUpdate(caseId)
                .orElseThrow(CaseNotFoundException::new);

        authorization.requireCanApprove(actor, caze, command);

        caze.approve(actor.id(), command.comment());
    }
}
```

### 33.3 Authorization service

```java
@Component
public class CaseApprovalAuthorization {

    private final AuthorizationAudit audit;

    public CaseApprovalAuthorization(AuthorizationAudit audit) {
        this.audit = audit;
    }

    public void requireCanApprove(Actor actor, Case caze, ApproveCaseCommand command) {
        PolicyDecision decision = evaluate(actor, caze, command);
        audit.record(actor, "case.approve", caze.id(), decision);

        if (!decision.allowed()) {
            throw new AccessDeniedException(decision.reasonCode());
        }
    }

    public PolicyDecision evaluate(Actor actor, Case caze, ApproveCaseCommand command) {
        if (!actor.hasAuthority("case.approve")) {
            return PolicyDecision.deny("MISSING_PERMISSION", "case-approval-v1");
        }
        if (!actor.agencyId().equals(caze.agencyId())) {
            return PolicyDecision.deny("WRONG_AGENCY", "case-approval-v1");
        }
        if (!caze.status().equals(CaseStatus.PENDING_REVIEW)) {
            return PolicyDecision.deny("INVALID_STATE", "case-approval-v1");
        }
        if (!caze.assignedReviewerId().equals(actor.id())) {
            return PolicyDecision.deny("NOT_ASSIGNED_REVIEWER", "case-approval-v1");
        }
        if (caze.submittedBy().equals(actor.id())) {
            return PolicyDecision.deny("MAKER_CHECKER_VIOLATION", "case-approval-v1");
        }
        return PolicyDecision.allow("case-approval-v1");
    }
}
```

### 33.4 Domain aggregate

```java
public class Case {

    public void approve(String approverId, String comment) {
        if (status != CaseStatus.PENDING_REVIEW) {
            throw new InvalidCaseStateException("Case is not pending review");
        }
        this.status = CaseStatus.APPROVED;
        this.approvedBy = approverId;
        this.approvedAt = Instant.now();
        this.approvalComment = comment;
    }
}
```

Perhatikan pemisahan:

```text
- `@PreAuthorize` melakukan coarse permission guard.
- Authorization service melakukan rich actor/resource/context policy.
- Aggregate menjaga invariant state transition.
- Transaction menjaga consistency.
- Audit mencatat decision.
```

Ini jauh lebih kuat daripada satu annotation panjang.

---

## 34. Top 1% Insight

Engineer biasa bertanya:

```text
Annotation apa yang harus saya pakai?
```

Engineer senior bertanya:

```text
Di boundary mana keputusan authorization paling benar, paling sulit dibypass, dan paling bisa diaudit?
```

Method security adalah alat penting, tetapi bukan jawaban tunggal.

Insight utama:

1. Method security adalah **operation guard**, bukan sekadar role annotation.
2. Annotation cocok untuk **thin enforcement**, bukan policy kompleks jangka panjang.
3. SpEL bagus sebagai glue, buruk sebagai policy language besar.
4. Service-level authorization melindungi dari multi-entry-point bypass.
5. Mutation kritikal sering lebih aman dengan explicit in-transaction authorization daripada annotation-only.
6. `@PostFilter` bukan solusi data authorization untuk search/report/export.
7. Proxy semantics adalah bagian dari security model. Mengabaikannya berarti membuat bypass.
8. Authorization tanpa test negatif dan audit reason bukan production-grade authorization.
9. Untuk sistem regulatory/case management, authorization harus terhubung dengan state machine, assignment, maker-checker, delegation, dan audit defensibility.

---

## 35. Ringkasan

Part ini membahas Spring method security sebagai service-level authorization boundary.

Kita membahas:

```text
- kenapa method security penting
- annotation utama
- @PreAuthorize dan @PostAuthorize
- @PreFilter dan @PostFilter
- SpEL trade-off
- parameter binding
- proxy/self-invocation trap
- transaction ordering
- TOCTOU
- custom PermissionEvaluator
- custom expression root
- AuthorizationManager
- read/write/bulk operation patterns
- async/batch/message concern
- testing strategy
- audit/observability
- migration strategy
- Java 8–25 notes
```

Kesimpulan paling penting:

```text
Spring method security paling efektif ketika dipakai sebagai enforcement boundary yang tipis dan konsisten, sementara keputusan authorization yang kompleks dimodelkan sebagai service/domain policy yang typed, testable, auditable, dan transaction-aware.
```

---

## 36. Referensi

1. Spring Security Reference — Method Security  
   https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html

2. Spring Security Reference — Testing Method Security  
   https://docs.spring.io/spring-security/reference/servlet/test/method.html

3. Spring Security API — AuthorizationManager  
   https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/authorization/AuthorizationManager.html

4. Spring Security Migration 7 — Authorization Changes and `-parameters` note  
   https://docs.spring.io/spring-security/reference/6.5/migration-7/authorization.html

5. Spring Security Reference — Authorize HttpServletRequests  
   https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html

6. OWASP Authorization Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

7. OWASP API Security 2023 — Broken Object Level Authorization  
   https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

---

## Status Seri

Selesai:

```text
[x] Part 0  — Authorization Mental Model: From “Role Check” to Decision System
[x] Part 1  — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2  — Java Platform Authorization Primitives: What Still Matters, What Doesn’t
[x] Part 3  — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
[x] Part 4  — RBAC Done Properly: Role-Based Access Control Beyond ADMIN
[x] Part 5  — Permission and Capability Modeling
[x] Part 6  — ABAC: Attribute-Based Authorization
[x] Part 7  — PBAC and Policy-as-Code
[x] Part 8  — ReBAC: Relationship-Based Authorization
[x] Part 9  — ACL and Domain Object Security
[x] Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
[x] Part 11 — IDOR, BOLA, and Object-Level Authorization
[x] Part 12 — Authorization in Layered Java Applications
[x] Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
[x] Part 14 — Spring Method Security: Service-Level Authorization
```

Berikutnya:

```text
[ ] Part 15 — Spring Domain Authorization Patterns
```

Seri belum selesai.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-013.md">⬅️ Part 13 — Spring Security Authorization: Servlet Stack Deep Dive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-015.md">Part 15 — Spring Domain Authorization Patterns ➡️</a>
</div>
