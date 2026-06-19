# learn-java-template-freemarker-thymeleaf-rendering-engineering — Part 24
# Template Security Beyond XSS: SSTI, Sandbox, Data Leakage, and Abuse Cases

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Part: `024`  
> Topik: Advanced template security beyond normal XSS  
> Fokus: SSTI, sandbox, trust model, dangerous object exposure, resource exhaustion, data leakage, auditability, and secure dynamic template platforms  
> Target Java: Java 8 sampai Java 25

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 23, kita sudah membangun fondasi besar:

1. mental model template rendering,
2. FreeMarker architecture,
3. FTL expression/directive/macro,
4. FreeMarker object wrapping,
5. output escaping dan XSS,
6. diagnostics dan observability,
7. performance,
8. Spring/Jakarta integration,
9. Thymeleaf architecture,
10. Thymeleaf expression/attribute/form/layout/security/performance,
11. email/document rendering,
12. i18n/l10n,
13. data model contract,
14. template versioning/governance/multi-tenant template platform.

Part ini masuk ke area yang sering diremehkan:

> **template security beyond XSS**.

XSS adalah masalah output ke browser. Tetapi template engine juga punya risiko lain yang jauh lebih berbahaya:

- attacker membuat server mengevaluasi template expression,
- template author mengakses object Java yang tidak seharusnya,
- template mengeksekusi operasi mahal,
- template membocorkan data lintas tenant,
- template menjadi jalur privilege escalation,
- template yang tampak “hanya text” berubah menjadi execution surface.

Untuk engineer top-tier, template security harus dilihat sebagai kombinasi dari:

```text
language security
+ object exposure security
+ data minimization
+ resource control
+ governance
+ auditability
+ operational containment
```

---

## 1. Core Thesis

Thesis utama part ini:

> **Template engine bukan sekadar formatter. Template engine adalah interpreter kecil yang berjalan di dalam trust boundary aplikasi.**

Ketika engine memproses template, ia biasanya memiliki akses ke:

- data model,
- expression language,
- helper methods,
- object wrapper,
- template resolver,
- include/import mechanism,
- macro/directive library,
- output writer,
- kadang Spring context,
- kadang security principal,
- kadang request/session,
- kadang tenant metadata.

Jika salah satu boundary-nya longgar, template bisa berubah menjadi:

- data exfiltration primitive,
- business rule bypass,
- RCE stepping stone,
- denial-of-service vector,
- cross-tenant leak,
- audit tampering vector,
- privilege escalation surface.

Mental model yang lebih aman:

```text
Template = untrusted or semi-trusted program-like artifact
Data model = explicit capability object
Object wrapper = capability gateway
Resolver = filesystem/classpath/database boundary
Directive/helper = controlled API surface
Renderer = policy enforcement point
Output = serialized evidence/artifact
```

---

## 2. Threat Model: Apa yang Dilindungi?

Sebelum membahas SSTI dan sandbox, kita harus tahu aset yang dilindungi.

Dalam template system enterprise, asetnya bukan hanya HTML page.

Aset utama:

1. **confidential data**
   - PII,
   - case details,
   - internal remarks,
   - enforcement records,
   - identity information,
   - email recipient data,
   - tenant data,
   - audit trail.

2. **server execution boundary**
   - filesystem,
   - classloader,
   - process runtime,
   - environment variables,
   - Spring beans,
   - data source,
   - HTTP clients,
   - secret provider.

3. **business integrity**
   - generated decision letter,
   - warning notice,
   - approval/rejection document,
   - SLA escalation email,
   - correspondence wording,
   - legal timestamp,
   - template version.

4. **availability**
   - render latency,
   - batch notification throughput,
   - memory usage,
   - CPU usage,
   - queue processing.

5. **audit defensibility**
   - which template version was used,
   - which model data was rendered,
   - who edited/published the template,
   - whether output was altered,
   - whether rendering was deterministic.

Threat model template system harus bertanya:

```text
Who can edit templates?
Who can supply template fragments?
Who can supply data rendered into templates?
Who can select template ID/version?
Who can trigger rendering?
What Java objects are visible during rendering?
What helper methods are visible?
What external resources can template include?
How large can output become?
Can rendering be repeated deterministically?
Can one tenant influence another tenant's template or data?
```

---

## 3. Trust Matrix: Trusted Template vs Trusted Data

Template security sering kacau karena semua input dianggap sama. Padahal ada dua sumbu besar:

```text
                 DATA TRUST
                 trusted              untrusted
TEMPLATE  +-------------------+------------------------+
TRUST     | A                 | B                      |
trusted   | internal report   | web page with user data|
          +-------------------+------------------------+
untrusted | C                 | D                      |
          | admin-edit letter | user template platform |
          +-------------------+------------------------+
```

### 3.1 Case A — Trusted Template + Trusted Data

Contoh:

- internal operational report,
- developer-owned template,
- system-generated data.

Risiko utama:

- accidental leakage,
- broken formatting,
- performance regression,
- template/model contract mismatch.

Control:

- code review,
- versioning,
- tests,
- escaping,
- least privilege model.

### 3.2 Case B — Trusted Template + Untrusted Data

Contoh:

- public web page,
- email body containing user name/comment,
- case notes rendered into staff UI.

Risiko utama:

- XSS,
- HTML injection,
- CSV injection,
- log injection,
- document injection.

Control:

- context-aware escaping,
- sanitization for rich HTML,
- no raw output unless explicitly sanitized,
- output format discipline.

### 3.3 Case C — Untrusted/Semi-Trusted Template + Trusted Data

Contoh:

- business admin can edit email templates,
- tenant can customize document wording,
- CMS-like template editor.

Risiko utama:

- data leakage,
- expression abuse,
- access to unintended fields,
- helper misuse,
- template DoS,
- audit manipulation.

Control:

- strict model allowlist,
- restricted template language,
- no dangerous built-ins,
- no arbitrary object access,
- preview sandbox,
- approval workflow,
- resource limits.

### 3.4 Case D — Untrusted Template + Untrusted Data

Contoh:

- user-created public template,
- marketplace template,
- custom notification template from external party,
- template-as-a-service.

Risiko utama:

- SSTI,
- RCE,
- data exfiltration,
- tenant escape,
- platform DoS,
- storage abuse,
- SSRF if helpers exist,
- template supply-chain attacks.

Control:

- avoid general-purpose template engine if possible,
- use logic-less restricted language,
- isolate rendering process,
- sandbox at process/container level,
- no Java object exposure,
- rate limit,
- timeout,
- output size cap,
- audit all actions.

Rule of thumb:

> If template authors are not fully trusted developers, treat templates as executable-like content.

---

## 4. Server-Side Template Injection: Mental Model

OWASP describes SSTI as a vulnerability where user input is embedded into a server-side template unsafely and then processed by the template engine. Depending on the engine and exposure, it can lead to server-side code execution or data exposure.

Simple mental model:

```text
Unsafe system:

user input
   ↓
becomes template source
   ↓
engine parses it as template syntax
   ↓
attacker-controlled expression executes server-side
```

Important distinction:

```text
Safe interpolation:
Template source is fixed.
User input is data.

Unsafe template injection:
User input modifies template source.
User input becomes code/expression.
```

### 4.1 Safe Pattern

```java
String template = "Hello ${name}";  // fixed template controlled by app
Map<String, Object> model = Map.of("name", userInput);
render(template, model);
```

Here, `userInput` is data. The engine should escape it according to output format.

### 4.2 Unsafe Pattern

```java
String template = "Hello " + userInput; // user input becomes template source
render(template, model);
```

If `userInput` contains template syntax, the engine may evaluate it.

### 4.3 More Subtle Unsafe Pattern

```java
String adminTemplate = templateRepository.load(templateId);
String customized = adminTemplate.replace("{{customBlock}}", userProvidedBlock);
render(customized, model);
```

This is dangerous if `userProvidedBlock` can contain template syntax and is inserted before parsing/evaluation.

Better:

```text
Template source is parsed from approved template only.
User-customized fields are passed as escaped data values.
```

---

## 5. SSTI Is Not XSS

XSS:

```text
attacker code runs in victim browser
```

SSTI:

```text
attacker-controlled template expression runs on server-side template engine
```

XSS usually attacks browser/user session. SSTI attacks server runtime.

Comparison:

| Dimension | XSS | SSTI |
|---|---|---|
| Execution location | Browser | Server-side template engine |
| Primary unsafe act | Unescaped output | User input parsed as template |
| Common impact | Session theft, DOM manipulation, account action | Data leakage, RCE, SSRF, DoS, privilege escalation |
| Main defense | Context-aware output encoding | Never treat user input as template source; restrict engine capability |
| Dangerous object exposure | Usually not relevant | Central risk |
| Sandbox relevance | Browser sandbox partly relevant | Engine/process sandbox critical |

A system can be safe from XSS but still vulnerable to SSTI.

Example:

```text
Rendered output is escaped HTML.
But before output, attacker expression reads secret data server-side.
```

No XSS occurs, but confidentiality is already lost.

---

## 6. Dangerous Pattern: Dynamic Template Evaluation

Any API that compiles/parses template source from string must be treated carefully.

Dangerous scenarios:

```text
renderString(userInput, model)
renderTemplateFromRequestParam(...)
renderTemplateFromDatabaseWithoutApproval(...)
renderTemplateFromTenantEditableText(...)
renderTemplateAfterStringReplace(...)
```

Potentially dangerous FreeMarker style:

```java
Template template = new Template("dynamic", userProvidedString, configuration);
template.process(model, writer);
```

Potentially dangerous Thymeleaf style:

```java
Context context = new Context(locale, model);
templateEngine.process(userProvidedTemplateNameOrContent, context);
```

With Thymeleaf, risk also depends on resolver configuration. If user controls the template name, they may attempt path traversal, unauthorized template selection, or expression preprocessing patterns depending on how the application uses template names and fragments.

Safer design:

```text
User selects from allowed template IDs.
Template ID maps to approved template version.
Template source is immutable after approval.
User content is model data, not template code.
```

---

## 7. Template Name Injection and Template Path Traversal

SSTI is often discussed as expression injection, but template name selection is also dangerous.

Unsafe:

```java
String view = request.getParameter("view");
return view;
```

If used as view name or template name, attacker may attempt:

```text
../admin/secret
classpath:...
fragments/internal :: privilegedBlock
tenantA/privateTemplate
```

Whether this works depends on resolver rules, but the design is already weak.

Safer:

```java
enum PublicView {
    HOME("public/home"),
    PROFILE("public/profile"),
    HELP("public/help");

    private final String templateName;
}
```

or:

```java
TemplateDescriptor descriptor = templateCatalog.resolveAllowed(
    tenantId,
    templatePurpose,
    templateVersionPolicy
);
```

Security invariant:

> External input may select business intent, not raw template path.

Bad:

```text
GET /render?template=../../admin/internal
```

Good:

```text
POST /letters/render
{
  "letterType": "REJECTION_NOTICE",
  "caseId": "..."
}
```

The application resolves the template internally.

---

## 8. FreeMarker Attack Surface

FreeMarker is powerful because it can expose Java objects and methods through object wrappers. That power must be controlled.

Relevant surfaces:

1. template source control,
2. data model field exposure,
3. JavaBean/method exposure,
4. `ObjectWrapper` choice,
5. `BeansWrapper` behavior,
6. `?api` availability,
7. `?new` and class resolving,
8. custom directives/methods,
9. include/import/template loader,
10. shared variables,
11. exception details.

### 8.1 ObjectWrapper as Capability Gateway

`ObjectWrapper` determines how Java objects appear to FTL. If the wrapper exposes methods broadly, template authors gain more capability.

Unsafe mindset:

```text
“Template only sees what I put in the model.”
```

More accurate:

```text
Template sees whatever the object wrapper exposes from objects I put in the model.”
```

If you put this into the model:

```java
model.put("case", caseEntity);
```

The template may access more than intended:

```ftl
${case.internalNote}
${case.createdBy.email}
${case.attachments[0].storageKey}
```

Depending on wrapper and object graph, it may traverse deep structures.

Safer:

```java
model.put("case", new CaseLetterView(
    publicCaseNumber,
    applicantName,
    decisionDateText,
    allowedReasons
));
```

### 8.2 BeansWrapper and Method Exposure

`BeansWrapper` can expose JavaBeans properties and methods. This is convenient for developer-owned templates, but risky for admin/user-owned templates.

Danger signs:

```text
Template can call methods.
Template can navigate arbitrary object graph.
Template can access collections/maps freely.
Template can access helper objects with side effects.
```

Bad model:

```java
model.put("userService", userService);
model.put("caseRepository", caseRepository);
model.put("environment", environment);
model.put("request", httpServletRequest);
model.put("securityContext", securityContext);
```

This creates a capability leak.

Better model:

```java
model.put("case", caseView);
model.put("recipient", recipientView);
model.put("org", organizationView);
model.put("format", safeFormattingHelpers);
```

Where `safeFormattingHelpers` contains pure formatting functions only.

### 8.3 `?api` Risk

FreeMarker expert built-ins include features intended for advanced cases. The `?api` built-in can expose the underlying Java API of wrapped objects when enabled/supported.

Production rule:

```text
Do not enable API built-ins for templates that are not fully trusted developer-owned code.
```

Even for trusted templates, ask why it is needed. Frequent need for `?api` usually means the data model is poorly shaped.

### 8.4 `?new` and Class Resolution

Any feature that allows templates to instantiate or resolve Java classes must be restricted.

Bad:

```text
Template can resolve arbitrary Java classes.
```

Better:

```text
Template cannot instantiate classes.
Only approved template models/directives are available.
```

FreeMarker has `TemplateClassResolver` options for restricting what classes can be resolved. For dynamic/semi-trusted templates, class resolution should be disabled or restricted to a strict allowlist.

### 8.5 Shared Variables

Shared variables are visible across templates. They are useful for macros/helpers, but dangerous if they expose mutable or powerful objects.

Bad shared variables:

```java
configuration.setSharedVariable("dataSource", dataSource);
configuration.setSharedVariable("applicationContext", applicationContext);
configuration.setSharedVariable("httpClient", httpClient);
configuration.setSharedVariable("secretClient", secretClient);
```

Acceptable shared variables:

```java
configuration.setSharedVariable("formatDate", safeFormatDateMethod);
configuration.setSharedVariable("mask", safeMaskingMethod);
configuration.setSharedVariable("components", safeMacroLibrary);
```

Rule:

> Shared variables should be pure, deterministic, side-effect-free, and low privilege.

---

## 9. Thymeleaf Attack Surface

Thymeleaf is often perceived as safer because it is HTML-oriented and natural-template oriented. But Thymeleaf also has expression evaluation, template resolution, fragment resolution, inlining, and Spring integration.

Relevant surfaces:

1. template name selection,
2. fragment expression selection,
3. expression evaluation,
4. SpringEL access,
5. utility objects,
6. model object exposure,
7. `th:utext`,
8. JavaScript/CSS inlining,
9. decoupled logic,
10. dialects/processors,
11. custom expression objects,
12. template resolver configuration.

### 9.1 Template Name Control

Unsafe:

```java
@GetMapping("/page")
public String page(@RequestParam String name) {
    return name;
}
```

This allows external input to become view/template selection.

Safer:

```java
@GetMapping("/page")
public String page(@RequestParam PageKind kind, Model model) {
    return switch (kind) {
        case HELP -> "public/help";
        case TERMS -> "public/terms";
        case CONTACT -> "public/contact";
    };
}
```

### 9.2 Fragment Selection Control

Thymeleaf supports fragment expressions. If fragment selectors are built from user input, attackers may attempt to render unauthorized fragments.

Bad:

```html
<div th:replace="~{${userSelectedFragment}}"></div>
```

Better:

```java
String fragment = allowedFragmentRegistry.resolve(userIntent);
model.addAttribute("fragment", fragment);
```

Even better, avoid dynamic fragment selection in templates unless selection has already been validated by application code.

### 9.3 SpringEL and Model Exposure

In Spring integration, Thymeleaf uses SpringEL. If you expose complex objects, templates can traverse them.

Bad:

```java
model.addAttribute("caseEntity", caseEntity);
model.addAttribute("principal", authentication);
model.addAttribute("request", request);
```

Better:

```java
model.addAttribute("page", pageView);
model.addAttribute("permissions", permissionView);
model.addAttribute("csrf", csrfView);
```

The template should not discover what it can access. The model should declare exactly what it may access.

### 9.4 `th:utext`

`th:utext` outputs unescaped text. It is not automatically wrong, but it must mean:

```text
This value is already sanitized and intentionally allowed as HTML.
```

Bad:

```html
<div th:utext="${comment.body}"></div>
```

Better:

```html
<div th:utext="${comment.safeHtmlBody}"></div>
```

Where `safeHtmlBody` is produced by an approved sanitizer policy.

### 9.5 Inlining Risk

JavaScript inlining is powerful but can be misused.

Bad mental model:

```text
“It is inside a script tag, so Thymeleaf will handle everything.”
```

Better:

```text
Inline JS is a separate output context. Keep data JSON-shaped, avoid mixing code and user text, and never build executable JS fragments from user/admin content.
```

---

## 10. Dangerous Object Exposure Patterns

This section is intentionally blunt.

Do not expose these objects to templates unless you have an extremely specific, reviewed reason:

```text
ApplicationContext
BeanFactory
Environment
DataSource
EntityManager
Repository
Service object
RestTemplate/WebClient/HTTP client
Secret manager client
File/System/Path object with arbitrary access
HttpServletRequest
HttpServletResponse
HttpSession
SecurityContext
Authentication object with full details
Class/ClassLoader
Runtime/ProcessBuilder
Logger with dynamic message misuse
Cache manager
Message broker client
```

Why?

Because templates should not become a service locator.

A secure template model should be closer to this:

```java
record CaseDecisionLetterModel(
    String caseNumber,
    String recipientName,
    String recipientAddressBlock,
    String decisionDateText,
    String decisionTypeText,
    List<String> publicReasons,
    String officerDisplayName,
    String agencyDisplayName,
    String supportContactText
) {}
```

Not this:

```java
model.put("case", caseEntity);
model.put("applicant", applicantEntity);
model.put("officer", officerEntity);
model.put("agency", agencyEntity);
model.put("repository", caseRepository);
model.put("security", securityContext);
```

Top 1% principle:

> The model is not a convenience map. The model is a capability contract.

---

## 11. Data Leakage Threats

Data leakage through templates can happen without SSTI.

Common leakage patterns:

1. **over-broad model**
   - entity exposed instead of view model.

2. **debug output**
   - template prints object dump.

3. **conditional leak**
   - hidden section visible due to wrong permission field.

4. **tenant mix-up**
   - template from tenant A rendered with model from tenant B.

5. **fragment leak**
   - internal fragment included accidentally.

6. **email recipient leak**
   - wrong recipient model.

7. **audit field leak**
   - internal remarks printed into external letter.

8. **exception leak**
   - stack trace or model values included in output.

9. **translation leak**
   - message key reveals internal state.

10. **preview leak**
   - admin preview can load real case data without authorization.

### 11.1 Example: Entity Exposure Leak

Domain entity:

```java
class EnforcementCase {
    String caseNumber;
    String publicDecisionReason;
    String internalInvestigationNote;
    String whistleblowerName;
    String officerRemark;
    List<Attachment> attachments;
}
```

Template:

```ftl
${case.internalInvestigationNote}
```

Even if not intended, if the field is reachable, it may be printed.

Better:

```java
record ExternalDecisionLetterView(
    String caseNumber,
    String publicDecisionReason
) {}
```

### 11.2 Preview Data Leak

CMS-like template editor often provides preview.

Bad:

```text
Admin can enter any caseId and preview all templates.
```

Better:

```text
Preview modes:
1. sample synthetic data,
2. authorized real data only,
3. redacted real data,
4. production preview requires explicit permission and audit log.
```

---

## 12. Authorization Rendering Is Not Authorization Enforcement

Templates often hide or show UI elements based on roles/permissions.

Example:

```html
<button th:if="${permissions.canApprove}">Approve</button>
```

This is fine for UX, but not security enforcement.

Required invariant:

```text
Every action endpoint must enforce authorization independently.
Template rendering may reflect authorization, but must not be the only authorization layer.
```

Bad:

```java
@PostMapping("/case/{id}/approve")
public String approve(@PathVariable String id) {
    caseService.approve(id);
    return "redirect:/case/" + id;
}
```

Good:

```java
@PostMapping("/case/{id}/approve")
public String approve(@PathVariable String id, Authentication authentication) {
    authorizationService.requireCanApprove(authentication, id);
    caseService.approve(id);
    return "redirect:/case/" + id;
}
```

Template permission fields should be derived from the same policy layer, but they are not the final guard.

---

## 13. Sandbox: What It Is and What It Is Not

A sandbox is a restricted execution environment.

But “sandbox” has layers:

```text
language-level sandbox
object exposure sandbox
template resolver sandbox
helper/directive sandbox
process/container sandbox
network sandbox
filesystem sandbox
resource limit sandbox
approval/governance sandbox
```

A template engine configuration alone is rarely a complete sandbox.

### 13.1 Language-Level Sandbox

Restrict what syntax/features are available.

Examples:

- no arbitrary class instantiation,
- no API access,
- no include outside allowlist,
- no raw template evaluation,
- limited method invocation,
- no recursive macro for untrusted authors,
- no dynamic template name.

### 13.2 Object Exposure Sandbox

Expose only safe objects.

```text
Safe object = immutable, minimal, purpose-specific, no side effects, no service access.
```

### 13.3 Resolver Sandbox

Template resolver must not read arbitrary filesystem/classpath/database rows.

Rules:

```text
Only approved template root.
No path traversal.
No absolute paths.
No tenant-crossing lookup.
No remote include unless explicitly designed and verified.
```

### 13.4 Process Sandbox

For high-risk dynamic templates, use process isolation.

Possible containment:

- separate rendering service,
- container with read-only filesystem,
- no cloud metadata access,
- no secret volume,
- no database network route,
- CPU/memory limit,
- timeout,
- output size cap,
- queue isolation.

### 13.5 Sandbox Misconception

Bad statement:

```text
“We disabled one dangerous built-in, so templates are sandboxed.”
```

Better statement:

```text
“We enforce restricted syntax, restricted model, restricted resolver, restricted helper API, resource limits, isolated runtime, and governance controls.”
```

---

## 14. Allowlist vs Denylist

For template security, allowlist wins.

Denylist problem:

```text
You block known dangerous names.
Attackers find alternate path.
Engine evolves.
Wrapper behavior changes.
Custom helper adds new capability.
```

Allowlist design:

```text
Only these template IDs are renderable.
Only these model fields exist.
Only these helper methods exist.
Only these include paths exist.
Only these output formats are allowed.
Only these template modes are allowed.
Only these authors can publish.
```

Example template capability manifest:

```yaml
templateId: correspondence.rejection-notice
version: 4
owner: correspondence-team
allowedOutputFormats:
  - HTML
  - PDF_PREHTML
allowedModelSchema: RejectionNoticeModel.v3
allowedHelpers:
  - format.date
  - format.currency
  - mask.nric
allowedIncludes:
  - components/header.ftlh
  - components/footer.ftlh
  - components/signature.ftlh
forbidden:
  apiAccess: true
  classResolution: true
  rawHtml: false
  dynamicInclude: true
resourceLimits:
  timeoutMillis: 500
  maxOutputBytes: 1048576
  maxLoopItems: 1000
```

---

## 15. Resource Exhaustion and Denial of Service

Template execution can exhaust resources even without malicious Java access.

Threats:

1. huge loops,
2. recursive macros/fragments,
3. enormous output,
4. expensive formatting,
5. repeated include/import,
6. large collection traversal,
7. reflection-heavy method access,
8. regex-heavy helpers,
9. nested layout explosion,
10. batch rendering amplification.

### 15.1 Huge Loop

Bad:

```ftl
<#list allCases as case>
  ${case.detail}
</#list>
```

If `allCases` contains 1 million items, rendering can consume CPU/memory and generate huge output.

Better:

```text
Application enforces page size or document row limit before rendering.
Template receives bounded list.
```

### 15.2 Recursive Macro

Bad:

```ftl
<#macro node n>
  <@node n=n />
</#macro>
```

Control:

- no user-defined recursive macros for semi-trusted templates,
- render timeout,
- output size cap,
- review/lint recursion,
- isolate render worker.

### 15.3 Large Output

Never allow unbounded output.

Renderer should wrap writer:

```java
final class BoundedWriter extends Writer {
    private final Writer delegate;
    private final long maxChars;
    private long written;

    BoundedWriter(Writer delegate, long maxChars) {
        this.delegate = delegate;
        this.maxChars = maxChars;
    }

    @Override
    public void write(char[] cbuf, int off, int len) throws IOException {
        if (written + len > maxChars) {
            throw new OutputLimitExceededException(maxChars);
        }
        delegate.write(cbuf, off, len);
        written += len;
    }

    @Override public void flush() throws IOException { delegate.flush(); }
    @Override public void close() throws IOException { delegate.close(); }
}
```

### 15.4 Timeout Caveat

Java thread interruption does not automatically stop all CPU-bound code if code ignores interrupts. Timeout should be layered:

```text
application-level timeout
+ worker pool isolation
+ process/container limit for high-risk templates
+ queue-level circuit breaker
```

### 15.5 Batch Amplification

One bad template rendered once is a bug. One bad template rendered 500,000 times is an incident.

Batch rendering must have:

- per-render limit,
- batch-level limit,
- failure threshold,
- circuit breaker,
- template quarantine,
- retry classification,
- dead-letter queue,
- metrics by template version.

---

## 16. Helper/Directive Security

Custom helpers are often the hidden backdoor.

Example helper:

```java
class LinkHelper {
    String fetchTitle(String url) { ... } // HTTP call
}
```

This seems useful until a template can trigger SSRF or slow network calls.

Dangerous helper types:

```text
HTTP helper
file helper
database helper
repository helper
environment helper
secret helper
reflection helper
JSON parser with huge input
regex helper with catastrophic backtracking
date helper using system default timezone unexpectedly
random helper causing nondeterministic documents
```

Safe helper properties:

```text
pure
side-effect-free
deterministic
bounded
non-networked
non-filesystem
no secret access
no database access
explicit locale/timezone
well-tested
```

Example safe helper:

```java
public final class SafeFormattingHelpers {
    public String formatDate(LocalDate date, Locale locale) {
        if (date == null) return "";
        return DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM)
                .withLocale(locale)
                .format(date);
    }

    public String maskIdentifier(String value) {
        if (value == null || value.length() < 4) return "****";
        return "****" + value.substring(value.length() - 4);
    }
}
```

Still, even safe helpers should be exposed through a narrow adapter, not through arbitrary service objects.

---

## 17. Template Injection Through Translation Messages

Message bundles can become injection sources.

Bad:

```properties
welcome.message=Hello ${user.name}
```

If message content is later evaluated as template source, translation becomes executable.

Usually message bundles should be treated as text patterns, not template programs.

Safer:

```properties
welcome.message=Hello {0}
```

Then format using message formatting, not template evaluation.

Risk scenario:

```text
translator edits message
message is fed into FreeMarker/Thymeleaf as dynamic template
translator gains template execution capability
```

Rule:

> Do not run i18n messages through template engines unless message authors are in the same trust class as template authors and the same governance applies.

---

## 18. Template Injection Through CMS Rich Text

CMS rich text often supports placeholders:

```text
Dear {{recipientName}}, your case {{caseNumber}} is approved.
```

This is not necessarily bad. The danger depends on implementation.

Bad implementation:

```text
Replace {{ }} with FreeMarker/Thymeleaf syntax and evaluate full template.
```

Better implementation:

```text
Use a restricted placeholder engine:
- only variable substitution,
- no method calls,
- no loops,
- no includes,
- no class access,
- no arbitrary expression.
```

Example restricted placeholder syntax:

```text
{{ recipient.name }}
{{ case.caseNumber }}
{{ decision.date }}
```

Allowed grammar:

```text
placeholder ::= '{{' path '}}'
path        ::= identifier ('.' identifier)*
identifier  ::= [a-zA-Z][a-zA-Z0-9_]*
```

No arithmetic, no function call, no bracket, no class, no template directive.

For many business-editable templates, this is enough.

Top-tier design decision:

> If business users only need placeholders, do not give them a general-purpose template language.

---

## 19. Multi-Tenant Abuse Cases

Multi-tenant template platforms add risks.

### 19.1 Tenant Template Escape

Bad key:

```text
templateName = tenantId + "/" + request.templateName
```

If `request.templateName` contains traversal or alias tricks, tenant may access another tenant's template.

Better:

```text
TemplateRepository.findPublishedTemplate(
    tenantId,
    templatePurpose,
    effectiveDate
)
```

Tenant ID is not path text. It is query scope enforced by repository.

### 19.2 Global Component Override

Tenant can override `footer.ftlh`, which is imported by global templates.

Risk:

```text
Tenant footer changes behavior of unrelated templates.
```

Better:

```text
Tenant overrides only allowed extension points.
Global security/legal footer cannot be overridden unless explicitly allowed.
```

### 19.3 Cross-Tenant Preview

Bad:

```text
User with tenant A access previews template with tenant B sample data.
```

Control:

- tenant-scoped template IDs,
- tenant-scoped sample data,
- tenant-scoped authorization,
- audit preview events.

### 19.4 Shared Cache Key Bug

Bad cache key:

```text
cacheKey = templateName
```

Better:

```text
cacheKey = tenantId + templateId + version + locale + outputFormat
```

If template cache ignores tenant/version/locale, wrong output or wrong template can leak.

---

## 20. Audit and Forensics

Security without audit is weak in enterprise template systems.

Record these events:

1. template created,
2. template edited,
3. template submitted for review,
4. template approved,
5. template published,
6. template retired,
7. template rendered,
8. rendering failed,
9. preview generated,
10. dangerous feature blocked,
11. compatibility validation failed,
12. model schema mismatch,
13. output limit exceeded,
14. template quarantined.

Render audit record should include:

```json
{
  "renderId": "rnd_...",
  "templateId": "correspondence.rejection-notice",
  "templateVersion": 4,
  "templateHash": "sha256:...",
  "modelSchema": "RejectionNoticeModel.v3",
  "modelHash": "sha256:...",
  "tenantId": "agency-a",
  "locale": "en-SG",
  "timezone": "Asia/Singapore",
  "outputFormat": "HTML",
  "renderedAt": "2026-06-19T03:12:00Z",
  "renderedBy": "system:case-workflow",
  "correlationId": "...",
  "durationMillis": 38,
  "status": "SUCCESS"
}
```

Do not store raw sensitive model blindly. Use:

- hash,
- redacted snapshot,
- encrypted snapshot,
- retention policy,
- access control.

For legal/regulatory document rendering, consider immutable evidence bundle:

```text
template source hash
+ template metadata
+ model snapshot/hash
+ render configuration
+ output hash
+ timestamp
+ actor/system identity
```

---

## 21. Secure Dynamic Template Platform Architecture

A secure platform has multiple gates.

```text
             ┌──────────────────────┐
             │ Template Author/Admin │
             └──────────┬───────────┘
                        │
                        ▼
              ┌───────────────────┐
              │ Draft Template     │
              └────────┬──────────┘
                       │
           lint + parse + policy validation
                       │
                       ▼
              ┌───────────────────┐
              │ Compatibility Test │
              └────────┬──────────┘
                       │
            sample render + security checks
                       │
                       ▼
              ┌───────────────────┐
              │ Review / Approval  │
              └────────┬──────────┘
                       │
                       ▼
              ┌───────────────────┐
              │ Published Version  │
              └────────┬──────────┘
                       │
                       ▼
              ┌───────────────────┐
              │ Render Runtime     │
              └────────┬──────────┘
                       │
       bounded model + safe helpers + limits
                       │
                       ▼
              ┌───────────────────┐
              │ Output + Audit     │
              └───────────────────┘
```

### 21.1 Draft Validation

On save:

- parse template,
- reject forbidden syntax,
- validate include/import allowlist,
- validate placeholders,
- detect recursion,
- detect disallowed built-ins,
- check output format,
- check template mode,
- store draft hash.

### 21.2 Publish Validation

Before publish:

- render with sample models,
- render with edge case models,
- run security tests,
- run output size test,
- run locale matrix,
- run compatibility against model schema,
- require approval.

### 21.3 Runtime Enforcement

At render:

- resolve only published template,
- enforce tenant scope,
- validate model schema,
- use safe object wrapper/context,
- use bounded writer,
- apply timeout,
- capture metrics,
- audit output hash.

---

## 22. Secure FreeMarker Configuration Pattern

Example direction, not universal copy-paste:

```java
public final class SecureFreeMarkerFactory {

    public Configuration create() {
        Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);

        cfg.setDefaultEncoding("UTF-8");
        cfg.setLocalizedLookup(false);
        cfg.setLogTemplateExceptions(false);
        cfg.setWrapUncheckedExceptions(true);
        cfg.setFallbackOnNullLoopVariable(false);

        cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);

        // Prefer .ftlh/.ftlx or explicitly set output format for HTML/XML templates.
        cfg.setRecognizeStandardFileExtensions(true);

        // Template loader should be constrained to approved location/repository.
        cfg.setTemplateLoader(approvedTemplateLoader());

        // Use a controlled wrapper; do not expose arbitrary Java API for semi-trusted templates.
        cfg.setObjectWrapper(secureObjectWrapper());

        // Do not set powerful shared variables.
        cfg.setSharedVariable("format", new SafeFormatDirectiveOrMethod());

        return cfg;
    }

    private TemplateLoader approvedTemplateLoader() {
        // Example only. In real platform, enforce tenant/template/version scope outside path text.
        return new ClassTemplateLoader(getClass(), "/approved-templates");
    }

    private ObjectWrapper secureObjectWrapper() {
        DefaultObjectWrapperBuilder builder =
                new DefaultObjectWrapperBuilder(Configuration.VERSION_2_3_34);

        // Configure conservatively. Exact settings depend on FreeMarker version and trust model.
        builder.setExposeFields(false);
        return builder.build();
    }
}
```

Security reminders:

```text
Configuration alone is not enough.
Model shape matters.
Template source control matters.
Helper exposure matters.
Resolver control matters.
Runtime containment matters.
```

---

## 23. Secure Thymeleaf Configuration Pattern

Example direction:

```java
@Configuration
public class ThymeleafRenderingConfiguration {

    @Bean
    SpringTemplateEngine secureTemplateEngine(
            SpringResourceTemplateResolver resolver,
            Set<IDialect> safeDialects
    ) {
        SpringTemplateEngine engine = new SpringTemplateEngine();
        engine.setTemplateResolver(resolver);
        engine.setEnableSpringELCompiler(false);

        // Add only reviewed dialects.
        for (IDialect dialect : safeDialects) {
            engine.addDialect(dialect);
        }

        return engine;
    }

    @Bean
    SpringResourceTemplateResolver templateResolver() {
        SpringResourceTemplateResolver resolver = new SpringResourceTemplateResolver();
        resolver.setPrefix("classpath:/templates/");
        resolver.setSuffix(".html");
        resolver.setTemplateMode(TemplateMode.HTML);
        resolver.setCharacterEncoding(StandardCharsets.UTF_8.name());
        resolver.setCacheable(true);
        resolver.setCheckExistence(true);
        return resolver;
    }
}
```

Design rules:

```text
Do not let request parameter become view name.
Do not expose service/repository/context objects.
Do not allow arbitrary dynamic fragment expression from user input.
Avoid th:utext except for sanitized HTML.
Review custom dialects/processors like application code.
```

---

## 24. Template Security Testing

Security must be tested at multiple layers.

### 24.1 Static Template Policy Test

Check for forbidden constructs.

Examples:

```text
FreeMarker:
- ?api
- ?new
- ?eval
- ?interpret
- dynamic include/import
- no_esc in restricted templates

Thymeleaf:
- th:utext in restricted templates
- dynamic th:replace from model value
- inline JavaScript with unsafe model
- unapproved dialect namespace
```

### 24.2 Model Exposure Test

Assert that model contains only allowed keys.

```java
@Test
void rejectionNoticeModel_exposesOnlyAllowedFields() {
    Map<String, Object> model = rendererModelFactory.create(caseId);

    assertThat(model.keySet()).containsExactlyInAnyOrder(
        "case",
        "recipient",
        "decision",
        "agency",
        "format"
    );

    assertThat(model).doesNotContainKeys(
        "request",
        "session",
        "securityContext",
        "caseEntity",
        "repository",
        "applicationContext"
    );
}
```

### 24.3 Negative Render Tests

Attempt to render disallowed syntax and expect rejection.

```java
@Test
void dynamicTemplate_rejectsApiBuiltIn() {
    String source = "${user?api}";

    assertThatThrownBy(() -> validator.validate(source))
        .isInstanceOf(TemplatePolicyViolationException.class)
        .hasMessageContaining("api");
}
```

### 24.4 Resource Limit Test

```java
@Test
void renderer_rejectsOutputAboveLimit() {
    RenderRequest request = hugeOutputRequest();

    assertThatThrownBy(() -> renderer.render(request))
        .isInstanceOf(OutputLimitExceededException.class);
}
```

### 24.5 Tenant Isolation Test

```java
@Test
void tenantCannotRenderOtherTenantTemplate() {
    assertThatThrownBy(() -> templateCatalog.resolve(
        TenantId.of("tenant-a"),
        TemplateId.of("tenant-b.private-letter"),
        RenderPurpose.PREVIEW
    )).isInstanceOf(TemplateNotFoundException.class);
}
```

### 24.6 Preview Authorization Test

```java
@Test
void previewWithRealCaseData_requiresCaseAccess() {
    assertThatThrownBy(() -> previewService.preview(
        userWithoutCaseAccess,
        templateId,
        realCaseId
    )).isInstanceOf(AccessDeniedException.class);
}
```

---

## 25. Secure Review Checklist

Use this checklist during design/review.

### 25.1 Template Source

```text
[ ] Can external users edit template source?
[ ] Can business admins edit template source?
[ ] Are editable templates treated as code-like artifacts?
[ ] Is there approval workflow before publish?
[ ] Is template source immutable after publish?
[ ] Is template source hashed?
[ ] Are includes/imports restricted?
[ ] Are dynamic includes prohibited or allowlisted?
```

### 25.2 Template Selection

```text
[ ] Can request parameter control template path?
[ ] Can request parameter control fragment path?
[ ] Is template selection based on business intent enum/catalog?
[ ] Is tenant scope enforced by repository, not string concatenation?
[ ] Is effective date/version resolved deterministically?
```

### 25.3 Data Model

```text
[ ] Are domain entities hidden from template?
[ ] Are service/repository/context objects absent?
[ ] Is the model schema explicit?
[ ] Are sensitive fields redacted before model creation?
[ ] Are field-level permissions applied before rendering?
[ ] Is locale/timezone explicit?
```

### 25.4 Engine Capability

```text
[ ] Is Java API access disabled for semi-trusted templates?
[ ] Is class resolution disabled/restricted?
[ ] Are expert built-ins reviewed?
[ ] Are custom directives pure and bounded?
[ ] Are shared variables safe?
[ ] Are custom dialects reviewed?
```

### 25.5 Output

```text
[ ] Is output format explicit?
[ ] Is auto-escaping enabled where applicable?
[ ] Is raw HTML sanitized before rendering?
[ ] Is CSV/spreadsheet injection considered?
[ ] Is PDF/document output reproducible?
[ ] Is output size bounded?
```

### 25.6 Runtime

```text
[ ] Is render timeout enforced?
[ ] Is output size cap enforced?
[ ] Is batch rendering protected by circuit breaker?
[ ] Is high-risk rendering isolated?
[ ] Are metrics recorded per template version?
[ ] Are failures classified?
```

### 25.7 Audit

```text
[ ] Is every publish event audited?
[ ] Is every render event audited where required?
[ ] Is preview audited?
[ ] Are template hash and output hash captured?
[ ] Is sensitive model snapshot protected?
[ ] Is rollback traceable?
```

---

## 26. Design Heuristics for Top 1% Engineers

### Heuristic 1 — Do Not Confuse Template Author with Data Author

Template author controls structure. Data author controls values.

Security model changes drastically when template author is external or semi-trusted.

### Heuristic 2 — Treat Model Fields as Capabilities

If a field exists in the model, assume template can use it.

Do not expose fields “just in case”.

### Heuristic 3 — Prefer Precomputed View Models

Templates should not discover, query, compute, or authorize.

Java prepares.
Template renders.

### Heuristic 4 — Avoid General-Purpose Template Language for Business Placeholder Needs

If business users only need:

```text
Dear {{name}}, your application {{applicationNo}} is approved.
```

then build restricted placeholder substitution, not full FTL/Thymeleaf editing.

### Heuristic 5 — Dynamic Templates Need Governance, Not Just Escaping

Escaping protects output context. It does not protect server execution capability.

### Heuristic 6 — Sandbox Is Layered

Engine configuration is one layer. Runtime isolation may still be required.

### Heuristic 7 — Preview Is Production-Like Risk

Preview often has looser controls but real data. Treat it as sensitive.

### Heuristic 8 — Cache Keys Are Security Boundaries

Template cache must include tenant/version/locale/output format where relevant.

### Heuristic 9 — Helper APIs Are Attack Surface

Every helper is a mini service exposed to templates.

### Heuristic 10 — Rendering Is Evidence

For official documents, rendering must be reproducible, attributable, and auditable.

---

## 27. Common Anti-Patterns

### Anti-Pattern 1 — Admin-Editable FreeMarker with Full Java Object Graph

```text
Business admin can edit FTL.
Model contains entity graph.
BeansWrapper exposes methods.
No review.
No sandbox.
```

This is a high-risk platform.

### Anti-Pattern 2 — Request Parameter as Template Name

```java
return request.getParameter("template");
```

This creates unauthorized template selection risk.

### Anti-Pattern 3 — Service Objects in Model

```java
model.put("caseService", caseService);
```

This turns template into application scripting.

### Anti-Pattern 4 — `th:utext` Everywhere

```html
<div th:utext="${anything}"></div>
```

This normalizes raw output and weakens review discipline.

### Anti-Pattern 5 — Dynamic Include From Model

```ftl
<#include userSelectedPath>
```

or:

```html
<div th:replace="~{${fragmentPath}}"></div>
```

If not strictly allowlisted, this is dangerous.

### Anti-Pattern 6 — Template Error Details in User Output

```text
TemplateException stack trace printed into page/email.
```

This leaks internal model paths, class names, template paths, and sometimes data.

### Anti-Pattern 7 — Unbounded Batch Rendering

```text
New template published.
Batch job renders 1 million emails.
Template has accidental huge loop.
System melts.
```

Batch rendering needs blast-radius control.

---

## 28. Practical Architecture: Safe Correspondence Template Platform

Imagine a regulatory correspondence platform.

Use cases:

- warning notice,
- rejection notice,
- approval letter,
- missing document reminder,
- SLA escalation,
- closure letter.

Security-sensitive requirements:

```text
Business can edit wording.
Legal must approve.
System must render immutable evidence.
Case data contains sensitive internal remarks.
Tenants/agencies have different branding.
Output can be email HTML and PDF.
```

Secure design:

```text
1. Template author edits restricted template syntax.
2. Template draft is parsed and linted.
3. Forbidden constructs are rejected.
4. Template references a declared model schema.
5. Sample data preview is default.
6. Real data preview requires case access.
7. Legal approval publishes immutable version.
8. Runtime selects template by case state + tenant + effective date.
9. Renderer builds explicit view model.
10. Renderer uses safe engine config and bounded writer.
11. Output hash and render metadata are audited.
12. Batch jobs use circuit breaker and per-template metrics.
```

Example model schema:

```json
{
  "schema": "WarningNoticeModel.v2",
  "fields": {
    "case.caseNumber": "string",
    "recipient.name": "string",
    "recipient.addressBlock": "string",
    "notice.issueDate": "localized-date",
    "notice.responseDeadline": "localized-date",
    "notice.publicReasonList": "list<string>",
    "agency.displayName": "string",
    "agency.contactEmail": "string"
  },
  "forbiddenDomainFields": [
    "internalInvestigationNote",
    "whistleblowerName",
    "officerPrivateRemark",
    "rawAttachmentStorageKey"
  ]
}
```

---

## 29. Java 8–25 Considerations

### 29.1 Java 8 Baseline

Java 8 is enough for:

- FreeMarker,
- Thymeleaf,
- classic MVC rendering,
- immutable-ish DTOs manually,
- executor-based timeout isolation,
- standard locale/time APIs through `java.time`.

But Java 8 lacks newer language ergonomics.

### 29.2 Java 11/17 LTS Improvements

Useful features:

- `var` for local readability if used carefully,
- better container awareness,
- stronger TLS defaults over time,
- records from Java 16+ if moving beyond 11,
- better GC options.

### 29.3 Java 17+

Records are excellent for template view models:

```java
public record RecipientView(
    String displayName,
    String addressBlock,
    String maskedIdentifier
) {}
```

Benefits:

- immutable by default,
- explicit fields,
- low boilerplate,
- good for contract clarity.

### 29.4 Java 21+

Virtual threads may help when rendering orchestration waits on I/O, but rendering itself is usually CPU/string/allocation work.

Good use:

```text
many independent rendering tasks that also fetch bounded data or write artifacts
```

Bad assumption:

```text
virtual threads make CPU-heavy template rendering faster
```

They improve concurrency model, not CPU per render.

### 29.5 Java 25

For this series, Java 25 is treated as modern upper bound. The template security principles do not depend on Java 25-specific syntax. The main advantage of newer Java is better platform ergonomics, observability, runtime behavior, language features, and deployment maturity.

---

## 30. Final Mental Model

A mature template rendering security model looks like this:

```text
Template source is controlled.
Template selection is controlled.
Template language capability is controlled.
Object exposure is controlled.
Helpers are controlled.
Data model is minimized.
Output context is explicit.
Rendering resources are bounded.
Tenant scope is enforced.
Preview is authorized.
Publication is governed.
Rendering is audited.
Failures are observable.
High-risk execution is isolated.
```

Or even shorter:

> **Templates should render decisions, not make decisions; format data, not fetch data; express presentation, not gain capability.**

---

## 31. What You Should Be Able to Do After This Part

After mastering this part, you should be able to:

1. distinguish XSS from SSTI,
2. explain why template source control is more dangerous than template data control,
3. classify template scenarios using trusted/untrusted template/data matrix,
4. identify dangerous object exposure in FreeMarker and Thymeleaf,
5. design a least-privilege template data model,
6. avoid request-controlled template names/fragments,
7. design sandbox layers beyond engine settings,
8. set resource limits for rendering,
9. build review checklist for dynamic template platforms,
10. secure preview and multi-tenant template rendering,
11. explain why helper functions are capability exposure,
12. design auditable rendering for official documents,
13. defend a template platform architecture in security review.

---

## 32. References

- Apache FreeMarker Documentation — ObjectWrapper, BeansWrapper, expert built-ins, configuration, template loading, output formats, and auto-escaping: https://freemarker.apache.org/docs/
- FreeMarker API — `ObjectWrapper`: https://freemarker.apache.org/docs/api/freemarker/template/ObjectWrapper.html
- FreeMarker Manual — expert built-ins: https://freemarker.apache.org/docs/ref_builtins_expert.html
- FreeMarker Manual — BeansWrapper: https://freemarker.apache.org/docs/pgui_misc_beanwrapper.html
- Thymeleaf Official Documentation: https://www.thymeleaf.org/documentation.html
- Thymeleaf 3.1 Tutorial — Using Thymeleaf: https://www.thymeleaf.org/doc/tutorials/3.1/usingthymeleaf.html
- OWASP Web Security Testing Guide — Testing for Server Side Template Injection: https://owasp.org/www-project-web-security-testing-guide/
- PortSwigger Web Security Academy — Server-side template injection: https://portswigger.net/web-security/server-side-template-injection
- Spring Framework Documentation — Web MVC and validation/data binding: https://docs.spring.io/spring-framework/reference/
- Oracle Java SE 25 Documentation: https://docs.oracle.com/en/java/javase/25/

---

## 33. Status Seri

```text
Part 24 selesai.
Seri belum selesai.
Berikutnya: Part 25 — Testing Strategy for Template Systems.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-023.md">⬅️ Part 23 — Template Versioning, Governance, CMS-like Editing, and Multi-Tenant Templates</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-025.md">Part 25 — Testing Strategy for Template Systems ➡️</a>
</div>
