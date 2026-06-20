# learn-java-camunda-7-bpm-platform-engineering-part-009.md

# Part 009 — Expression Language, Delegation Code, Bean Resolution, dan Runtime Binding

> Seri: `learn-java-camunda-7-bpm-platform-engineering`  
> Topik: Java Camunda BPM Platform / Camunda 7 `<= 7.x`  
> Level: Advanced / Principal Engineer  
> Fokus: expression language, delegation code, runtime binding, Spring/CDI bean resolution, classloading, versioning, dan coupling antara BPMN model dengan Java code

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas variable system: variable bukan sekadar `Map<String, Object>`, melainkan durable execution state yang punya scope, serialization strategy, history cost, dan migration impact.

Part ini melanjutkan pertanyaan yang secara natural muncul setelah variable:

> Bagaimana BPMN model “memanggil” Java code, Spring bean, CDI bean, expression, listener, atau method tertentu di runtime?

Di Camunda 7, process model bukan hanya diagram. BPMN XML bisa berisi binding ke Java class, delegate expression, expression method, listener, script, field injection, connector, external task, dan extension attributes. Karena itu, BPMN model bisa menjadi **runtime binding surface**.

Kalau binding ini didesain sembarangan, process model menjadi rapuh:

- rename package Java bisa merusak running process;
- bean name berubah bisa membuat job gagal;
- expression terlalu pintar bisa menyembunyikan business rule;
- field injection pada singleton bean bisa menyebabkan race condition;
- class delegate bisa sulit di-refactor;
- method expression bisa mengikat BPMN terlalu dalam ke application service;
- long-running process instance bisa masih mengeksekusi model lama dengan kode baru;
- shared engine bisa salah resolve bean jika process application/classloader tidak dipahami.

Part ini membangun mental model untuk menguasai area tersebut.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus mampu:

1. Membedakan `camunda:class`, `camunda:delegateExpression`, `camunda:expression`, listener, script, dan external task dari sudut runtime binding.
2. Memahami kapan BPMN model terikat ke class name, bean name, method signature, atau topic name.
3. Mendesain delegation code yang aman terhadap retry, rollback, concurrency, dan long-running versioning.
4. Menentukan kapan memakai JavaDelegate, expression, Spring bean, CDI bean, field injection, listener, atau external task.
5. Menghindari hidden coupling antara BPMN XML dan Java implementation.
6. Membuat contract layer yang stabil antara process model dan application code.
7. Mendiagnosis error umum seperti bean not found, class not found, expression evaluation failed, method not found, dan concurrency issue akibat singleton delegate.
8. Membuat convention production-grade untuk enterprise Camunda 7 estate.

---

## 2. Core Mental Model: BPMN Model sebagai Runtime Binding Document

Camunda 7 mem-parse BPMN XML menjadi process definition. Process definition ini bukan hanya graph aktivitas. Ia juga menyimpan metadata eksekusi:

- activity id;
- transition id;
- listener configuration;
- input/output mapping;
- service task implementation;
- expression;
- delegate expression;
- field injection;
- async flags;
- retry configuration;
- tenant id;
- version;
- deployment relationship.

Saat process execution mencapai activity tertentu, engine membaca metadata itu dan memutuskan:

```text
execution reaches BPMN element
        |
        v
engine checks element behavior
        |
        +--> wait state? persist and stop
        |
        +--> service task? invoke configured implementation
        |
        +--> listener? invoke configured listener
        |
        +--> expression? evaluate against EL context
        |
        +--> delegateExpression? resolve object from EL context, then call it
        |
        +--> class? instantiate configured Java class, then call it
```

Dengan kata lain:

> BPMN XML adalah kontrak runtime antara process engine dan application code.

Kontrak ini harus diperlakukan seperti API.

Jika BPMN model menyebut:

```xml
<serviceTask id="validateApplication"
             camunda:class="com.acme.workflow.ValidateApplicationDelegate" />
```

maka package name `com.acme.workflow.ValidateApplicationDelegate` menjadi bagian dari process definition contract.

Jika BPMN model menyebut:

```xml
<serviceTask id="validateApplication"
             camunda:delegateExpression="${validateApplicationDelegate}" />
```

maka bean name `validateApplicationDelegate` menjadi bagian dari process definition contract.

Jika BPMN model menyebut:

```xml
<serviceTask id="validateApplication"
             camunda:expression="${applicationService.validate(execution)}" />
```

maka bean name, method name, argument shape, dan expectation terhadap `execution` menjadi contract.

---

## 3. Binding Surface di Camunda 7

Camunda 7 menyediakan beberapa cara utama untuk mengeksekusi custom logic dari model:

| Mechanism | BPMN attribute / element | Runtime binding | Typical use |
|---|---|---|---|
| Java class delegate | `camunda:class` | Fully qualified class name | Simple embedded delegate |
| Delegate expression | `camunda:delegateExpression` | EL expression returning delegate object | Spring/CDI bean delegate |
| Method/value expression | `camunda:expression` | EL expression evaluated directly | Lightweight method call / variable evaluation |
| Execution listener | `camunda:executionListener` | class/expression/delegateExpression/script | React to lifecycle event |
| Task listener | `camunda:taskListener` | class/expression/delegateExpression/script | React to user task lifecycle |
| Script | `scriptTask` / listener script | Script engine | Rare, dynamic logic, legacy |
| External task | `camunda:type="external"` + topic | Topic string | Out-of-process workers |
| Connector | connector extension | connector id/config | Legacy integration shortcut |

Part ini fokus pada expression, delegate, listener, and bean binding. External task akan dibahas lebih dalam di part 011.

---

## 4. Expression Language di Camunda 7

Camunda 7 mendukung Unified Expression Language dan Friendly Enough Expression Language. Dalam dokumentasi Camunda 7.24, halaman Expression Language menyatakan Camunda 7 supports Unified Expression Language and Friendly Enough Expression Language.

Dalam praktik Camunda 7 BPMN, expression digunakan di banyak tempat:

- sequence flow condition;
- service task `camunda:expression`;
- service task `camunda:delegateExpression`;
- input/output mapping;
- listener expression;
- timer expression;
- candidate group expression;
- assignee expression;
- business key expression;
- field injection expression.

Contoh sequence flow condition:

```xml
<sequenceFlow id="approvedFlow"
              sourceRef="reviewGateway"
              targetRef="approvalTask">
  <conditionExpression xsi:type="tFormalExpression">
    ${reviewDecision == 'APPROVED'}
  </conditionExpression>
</sequenceFlow>
```

Contoh service task method expression:

```xml
<serviceTask id="calculateRisk"
             name="Calculate Risk"
             camunda:expression="${riskService.calculate(execution)}" />
```

Contoh delegate expression:

```xml
<serviceTask id="calculateRisk"
             name="Calculate Risk"
             camunda:delegateExpression="${calculateRiskDelegate}" />
```

Perbedaan penting:

- `expression` dievaluasi langsung;
- `delegateExpression` harus resolve ke object yang compatible dengan delegate behavior;
- `class` mengikat langsung ke Java class name.

---

## 5. `camunda:class`: Binding ke Fully Qualified Class Name

### 5.1 Apa yang Terjadi Saat Engine Menjalankan `camunda:class`

Contoh:

```xml
<serviceTask id="validateApplication"
             name="Validate Application"
             camunda:class="com.example.workflow.delegate.ValidateApplicationDelegate" />
```

Java:

```java
package com.example.workflow.delegate;

import org.camunda.bpm.engine.delegate.DelegateExecution;
import org.camunda.bpm.engine.delegate.JavaDelegate;

public final class ValidateApplicationDelegate implements JavaDelegate {

    @Override
    public void execute(DelegateExecution execution) throws Exception {
        String applicationId = (String) execution.getVariable("applicationId");

        if (applicationId == null || applicationId.isBlank()) {
            throw new IllegalArgumentException("applicationId is required");
        }

        execution.setVariable("validationStatus", "PASSED");
    }
}
```

Runtime behavior:

```text
engine reaches service task
        |
        v
reads camunda:class
        |
        v
loads class with relevant classloader
        |
        v
creates delegate instance
        |
        v
calls execute(DelegateExecution)
        |
        v
continues BPMN execution or rolls back on exception
```

Camunda documentation states that to implement a class callable during process execution, the class implements `org.camunda.bpm.engine.delegate.JavaDelegate` and provides logic in `execute`; when execution arrives at that step, the engine executes that method and leaves the activity in the default BPMN 2.0 way.

### 5.2 Strengths

`camunda:class` is straightforward:

- easy to understand;
- no Spring/CDI bean resolver required;
- good for small embedded examples;
- deterministic class target;
- fewer moving parts.

### 5.3 Weaknesses

For serious enterprise systems, it has serious coupling cost:

- BPMN XML contains fully qualified class name;
- package refactor breaks model;
- class must be available to engine runtime/classloader;
- dependency injection is not natural unless integrated carefully;
- testing may become awkward;
- implementation detail leaks into process model;
- versioning long-running processes becomes fragile.

### 5.4 When `camunda:class` is Acceptable

Use it when:

- no DI container is used;
- delegate is stateless and simple;
- BPMN and code are deployed as one immutable artifact;
- you control classloader and deployment lifecycle;
- model will not be shared across multiple applications;
- you accept package name as process contract.

Avoid it when:

- code depends on Spring services;
- model is maintained by business analysts;
- package refactor is common;
- long-running instances survive many releases;
- multiple process applications share engine;
- you need stable contract independent of Java package structure.

---

## 6. `camunda:delegateExpression`: Binding ke Delegate Object

### 6.1 Concept

Example:

```xml
<serviceTask id="validateApplication"
             name="Validate Application"
             camunda:delegateExpression="${validateApplicationDelegate}" />
```

Spring bean:

```java
import org.camunda.bpm.engine.delegate.DelegateExecution;
import org.camunda.bpm.engine.delegate.JavaDelegate;
import org.springframework.stereotype.Component;

@Component("validateApplicationDelegate")
public final class ValidateApplicationDelegate implements JavaDelegate {

    private final ApplicationValidationService validationService;

    public ValidateApplicationDelegate(ApplicationValidationService validationService) {
        this.validationService = validationService;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String applicationId = requireString(execution, "applicationId");

        ValidationResult result = validationService.validate(applicationId);

        execution.setVariable("validationStatus", result.status().name());
        execution.setVariable("validationReason", result.reason());
    }

    private static String requireString(DelegateExecution execution, String name) {
        Object value = execution.getVariable(name);
        if (value instanceof String s && !s.isBlank()) {
            return s;
        }
        throw new IllegalArgumentException("Missing required variable: " + name);
    }
}
```

Runtime behavior:

```text
engine reaches service task
        |
        v
reads delegateExpression
        |
        v
evaluates expression in EL context
        |
        v
resolves bean/object
        |
        v
object must implement JavaDelegate or compatible behavior
        |
        v
calls execute(execution)
```

### 6.2 Why Delegate Expression is Usually Better in Spring/CDI Systems

`delegateExpression` decouples BPMN from package name. The BPMN depends on a stable logical name, not a class path.

Instead of this:

```xml
camunda:class="com.company.caseworkflow.application.validation.v2.ValidateApplicationDelegate"
```

prefer:

```xml
camunda:delegateExpression="${validateApplicationDelegate}"
```

This makes refactor easier:

```java
@Component("validateApplicationDelegate")
public final class V3ApplicationValidationDelegate implements JavaDelegate {
    // package and class can change; bean name remains stable
}
```

### 6.3 But Delegate Expression is Still a Contract

Do not think delegate expression removes coupling. It only changes the coupling from class name to bean name.

The following are now contract:

- bean name;
- delegate interface;
- variable names read/written by delegate;
- exception semantics;
- transaction behavior;
- idempotency behavior;
- output variable schema;
- whether bean is singleton/prototype;
- whether field injection is used.

A mature team treats delegate expression names as public process API names.

Recommended naming:

```text
validateApplicationDelegate
calculateRiskScoreDelegate
reserveInspectionSlotDelegate
sendNotificationCommandDelegate
createCaseRecordDelegate
```

Avoid vague names:

```text
serviceTaskDelegate
commonDelegate
workflowHandler
processBean
utilityDelegate
```

---

## 7. `camunda:expression`: Binding ke Method or Value Expression

### 7.1 Example

```xml
<serviceTask id="notifyApplicant"
             name="Notify Applicant"
             camunda:expression="${notificationService.notifyApplicant(execution)}" />
```

Spring service:

```java
@Component("notificationService")
public class NotificationService {

    public void notifyApplicant(DelegateExecution execution) {
        String applicationId = (String) execution.getVariable("applicationId");
        // send notification or create outbox row
    }
}
```

This is concise, but it has design risk.

### 7.2 Method Expression Smell

Method expression can make BPMN too intimate with implementation:

```xml
${applicationService.validateAndPersistAndNotifyApplicant(execution)}
```

This BPMN now knows:

- bean name;
- method name;
- method argument type;
- orchestration sequence hidden inside method;
- side effects hidden behind expression;
- no explicit delegate contract;
- no obvious retry/idempotency wrapper.

For production systems, method expression should be used carefully.

### 7.3 Safe Uses of Expression

Good uses:

- sequence flow condition;
- simple assignment expression;
- derived value in input mapping;
- candidate group expression;
- low-risk read-only routing decision;
- call into stable rule/facade if intentionally exposed.

Risky uses:

- remote HTTP call;
- sending email;
- mutating business aggregate;
- multi-step command;
- complex validation;
- side-effect with no idempotency;
- method depending on many process variables.

### 7.4 A Better Pattern: Expression Calls a Stable Facade, Not Deep Application Service

Less ideal:

```xml
camunda:expression="${applicationService.validateAndUpdateStatusAndSendEmail(execution)}"
```

Better:

```xml
camunda:delegateExpression="${validateApplicationDelegate}"
```

Then the delegate calls application services:

```java
@Component("validateApplicationDelegate")
public final class ValidateApplicationDelegate implements JavaDelegate {

    private final ValidateApplicationUseCase useCase;

    public ValidateApplicationDelegate(ValidateApplicationUseCase useCase) {
        this.useCase = useCase;
    }

    @Override
    public void execute(DelegateExecution execution) {
        ValidateApplicationCommand command = ValidateApplicationCommand.from(execution);
        ValidateApplicationResult result = useCase.handle(command);
        result.writeTo(execution);
    }
}
```

The BPMN is now bound to a stable workflow adapter, not to arbitrary service internals.

---

## 8. Field Injection

### 8.1 What Field Injection Does

Field injection allows BPMN XML to configure delegate fields.

Example:

```xml
<serviceTask id="sendNotification"
             name="Send Notification"
             camunda:class="com.example.workflow.SendNotificationDelegate">
  <extensionElements>
    <camunda:field name="templateCode" stringValue="APPLICATION_RECEIVED" />
    <camunda:field name="recipientVariable">
      <camunda:string>applicantEmail</camunda:string>
    </camunda:field>
  </extensionElements>
</serviceTask>
```

Delegate:

```java
public final class SendNotificationDelegate implements JavaDelegate {

    private Expression templateCode;
    private Expression recipientVariable;

    public void setTemplateCode(Expression templateCode) {
        this.templateCode = templateCode;
    }

    public void setRecipientVariable(Expression recipientVariable) {
        this.recipientVariable = recipientVariable;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String template = (String) templateCode.getValue(execution);
        String recipientVarName = (String) recipientVariable.getValue(execution);
        String recipient = (String) execution.getVariable(recipientVarName);

        // send notification or create outbox row
    }
}
```

Camunda documentation says field injection supports fixed string values and expressions; injection should target `org.camunda.bpm.engine.delegate.Expression`, and public setters should be preferred because private field modification may fail with proxies or security manager configuration.

### 8.2 Important Runtime Detail

For `camunda:class`, Camunda creates a separate delegate instance when the service task executes, so injected values are applied to that instance.

But for Spring singleton beans, field injection is dangerous.

The Camunda docs explicitly warn that field injection should usually not be used with Spring beans, which are singletons by default, because concurrent modification of bean fields can cause inconsistencies.

This matters enormously in production.

### 8.3 Why Field Injection + Singleton Bean is Dangerous

Suppose:

```xml
<serviceTask id="sendApprovalEmail"
             camunda:delegateExpression="${sendEmailDelegate}">
  <extensionElements>
    <camunda:field name="template" stringValue="APPROVAL" />
  </extensionElements>
</serviceTask>

<serviceTask id="sendRejectionEmail"
             camunda:delegateExpression="${sendEmailDelegate}">
  <extensionElements>
    <camunda:field name="template" stringValue="REJECTION" />
  </extensionElements>
</serviceTask>
```

Spring bean:

```java
@Component("sendEmailDelegate")
public class SendEmailDelegate implements JavaDelegate {

    private Expression template;

    public void setTemplate(Expression template) {
        this.template = template;
    }

    @Override
    public void execute(DelegateExecution execution) {
        String templateCode = (String) template.getValue(execution);
        // send email
    }
}
```

If the bean is singleton, two executions on two threads can mutate the same `template` field.

Potential failure:

```text
Thread A enters sendApprovalEmail, injects template=APPROVAL
Thread B enters sendRejectionEmail, injects template=REJECTION
Thread A reads template and accidentally sends REJECTION
```

In a regulatory system, this is catastrophic.

### 8.4 Safer Alternatives

Prefer one bean per semantic operation:

```xml
camunda:delegateExpression="${sendApprovalEmailDelegate}"
camunda:delegateExpression="${sendRejectionEmailDelegate}"
```

Or use BPMN input mapping into a variable/local variable:

```xml
<serviceTask id="sendApprovalEmail"
             camunda:delegateExpression="${sendEmailDelegate}">
  <extensionElements>
    <camunda:inputOutput>
      <camunda:inputParameter name="notificationTemplate">APPROVAL</camunda:inputParameter>
    </camunda:inputOutput>
  </extensionElements>
</serviceTask>
```

Then delegate reads execution-local data:

```java
String template = (String) execution.getVariableLocal("notificationTemplate");
```

Or make delegate stateless and route through stable command object.

---

## 9. Bean Resolution in Spring

### 9.1 Default Exposure Problem

In Spring integration, expressions can resolve Spring beans. Camunda documentation states that with `ProcessEngineFactoryBean`, expressions and scripts in BPMN processes will by default see all Spring beans; it is possible to limit exposed beans by configuring a map, and if no `beans` property is set, all Spring beans in the context are available.

This is powerful but dangerous.

If all beans are visible, BPMN can call anything:

```xml
${userRepository.deleteAll()}
${paymentService.refund(execution)}
${internalAdminService.grantRole(userId, 'ADMIN')}
${dataSource.connection.close()}
```

Whether these exact expressions succeed depends on context and method visibility, but the architectural problem is clear: unbounded bean exposure makes BPMN a privileged scripting surface.

### 9.2 Production Rule

For serious enterprise systems:

> Do not expose your entire Spring application context to BPMN expressions unless you have a strong reason and a compensating control.

Prefer exposing a small map of workflow-facing beans:

```java
@Configuration
class CamundaExpressionConfiguration {

    @Bean
    SpringProcessEngineConfiguration processEngineConfiguration(
            DataSource dataSource,
            PlatformTransactionManager transactionManager,
            ValidateApplicationDelegate validateApplicationDelegate,
            CalculateRiskDelegate calculateRiskDelegate,
            SendNotificationDelegate sendNotificationDelegate) {

        SpringProcessEngineConfiguration cfg = new SpringProcessEngineConfiguration();
        cfg.setDataSource(dataSource);
        cfg.setTransactionManager(transactionManager);

        Map<Object, Object> beans = new HashMap<>();
        beans.put("validateApplicationDelegate", validateApplicationDelegate);
        beans.put("calculateRiskDelegate", calculateRiskDelegate);
        beans.put("sendNotificationDelegate", sendNotificationDelegate);
        cfg.setBeans(beans);

        return cfg;
    }
}
```

Spring Boot starter configuration differs in wiring style, but the principle is the same: expose intentional workflow adapter beans, not arbitrary application internals.

### 9.3 Bean Naming Convention

Use stable names:

```java
@Component("calculateRiskScoreDelegate")
public final class CalculateRiskScoreDelegate implements JavaDelegate { ... }
```

Avoid relying on default bean name if refactor risk is high:

```java
@Component
public final class CalculateRiskScoreDelegate implements JavaDelegate { ... }
```

Default bean name may become `calculateRiskScoreDelegate`, but explicit naming makes contract visible.

### 9.4 Shared Engine Bean Resolution

In shared engine deployment, there may be multiple process applications. The engine cannot simply use one Spring application context for all process definitions. Camunda documentation explains that in shared process engine deployment, expression resolution delegates to the corresponding process application and then to the local Spring application context via `SpringProcessApplicationElResolver`.

This implies:

- process application boundaries matter;
- classloader boundaries matter;
- same bean name in different applications can be valid if resolved in each application context;
- deployment registration matters;
- packaging of `camunda-engine-spring` can affect detection.

Mental model:

```text
shared engine
    |
    +--> process application A context
    |       +--> validateApplicationDelegate
    |
    +--> process application B context
            +--> validateApplicationDelegate
```

The same bean name can resolve differently depending on process application.

This is useful but can confuse operations if deployments are mixed incorrectly.

---

## 10. CDI / Java EE Bean Resolution

In Java EE/CDI style deployments, expression resolution can target CDI beans rather than Spring beans. The same architectural concerns apply:

- bean name is contract;
- scope matters;
- proxy behavior matters;
- field injection to private fields is fragile;
- classloader/process application boundaries matter;
- deployment artifact lifecycle matters.

CDI introduces additional nuance:

- CDI beans may be proxied;
- normal-scoped beans are often proxies;
- private field injection via reflection can fail or behave unexpectedly;
- contextual scope must be understood;
- injected services may participate in container-managed transaction differently.

Rule:

> With CDI or Java EE, prefer explicit delegate beans and constructor/service injection where possible. Avoid field injection from BPMN into CDI beans.

---

## 11. Classloading and Deployment Binding

Camunda 7 can run in different topologies:

1. embedded engine inside Spring Boot application;
2. shared engine inside application server;
3. remote engine distribution;
4. Camunda Run;
5. multiple process applications deployed to same engine;
6. clustered nodes sharing database.

Classloading behavior differs.

### 11.1 Embedded Engine

```text
Spring Boot app
    |
    +-- process engine
    +-- delegates
    +-- BPMN resources
    +-- application services
```

Simpler:

- process engine and delegates share app classloader;
- Spring beans are local;
- deployment usually tied to app startup;
- model and code version move together.

Risk:

- every app instance has engine;
- all nodes may execute jobs;
- rolling deployment can create model/code skew if not careful;
- BPMN deployment versioning must be controlled.

### 11.2 Shared Engine

```text
Application server
    |
    +-- shared process engine
    +-- process app A
    +-- process app B
```

More complex:

- engine dispatches into process application;
- delegates live inside process application;
- deployment registration matters;
- classloader isolation matters;
- expression resolution is process-application-aware.

Risk:

- job executor node may pick jobs for deployment whose classes are unavailable if deployment-aware behavior is not configured correctly;
- process app undeploy can leave jobs pointing to unavailable code;
- bean name collision can confuse humans, even if runtime resolves correctly.

### 11.3 Remote Engine

If your app only uses REST API against Camunda webapp/engine, local JavaDelegate classes are not available unless deployed into engine runtime.

Do not expect this to work:

```xml
<serviceTask camunda:class="com.myapp.LocalDelegate" />
```

unless `LocalDelegate` is actually packaged in the engine/process application runtime.

For remote engines, external task or message/event integration is usually a better fit.

---

## 12. Runtime Binding Choices: Decision Matrix

| Need | Recommended mechanism | Why |
|---|---|---|
| Simple process variable condition | Expression | Natural BPMN condition |
| Call Spring service through stable adapter | Delegate expression | Stable bean contract + DI |
| Execute Java class without DI | `camunda:class` | Simple embedded binding |
| Call remote system with retries and workers | External task | Out-of-process reliability |
| Wait for external event | Message catch + correlation | Durable subscription |
| Notify on task create/assign/complete | Task listener | User task lifecycle hook |
| Audit lifecycle event | Execution listener / history handler | Lifecycle hook, but avoid business logic abuse |
| Dynamic configuration per activity | Input/output mapping | Safer than singleton field injection |
| Advanced custom engine behavior | Engine plugin/parse listener | Only when justified |
| Business decision | DMN / rule service | More explicit than expression soup |

---

## 13. Delegation Code as Workflow Adapter Layer

A mature Camunda 7 Java application should avoid putting raw business service calls directly in BPMN expressions.

Recommended structure:

```text
BPMN model
    |
    v
Workflow delegate / adapter
    |
    v
Application use case
    |
    v
Domain service / repository / gateway
    |
    v
External system / database / message broker
```

Example package layout:

```text
com.example.caseapp.workflow.delegate
    ValidateApplicationDelegate
    CalculateRiskScoreDelegate
    AssignInspectionDelegate
    CreateOutboxNotificationDelegate

com.example.caseapp.workflow.contract
    WorkflowVariables
    WorkflowErrors
    WorkflowActivityIds
    WorkflowMessageNames

com.example.caseapp.application
    ValidateApplicationUseCase
    CalculateRiskScoreUseCase
    AssignInspectionUseCase

com.example.caseapp.domain
    Application
    RiskScore
    OfficerAssignment
```

Key idea:

> Delegate is not the domain model. Delegate is adapter between Camunda execution context and application use case.

---

## 14. A Production-Grade Delegate Template

```java
package com.example.caseapp.workflow.delegate;

import org.camunda.bpm.engine.delegate.BpmnError;
import org.camunda.bpm.engine.delegate.DelegateExecution;
import org.camunda.bpm.engine.delegate.JavaDelegate;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component("validateApplicationDelegate")
public final class ValidateApplicationDelegate implements JavaDelegate {

    private static final Logger log = LoggerFactory.getLogger(ValidateApplicationDelegate.class);

    private final ValidateApplicationUseCase useCase;

    public ValidateApplicationDelegate(ValidateApplicationUseCase useCase) {
        this.useCase = useCase;
    }

    @Override
    public void execute(DelegateExecution execution) {
        WorkflowContext ctx = WorkflowContext.from(execution);

        log.info("Validating application. processInstanceId={}, businessKey={}, applicationId={}",
                ctx.processInstanceId(), ctx.businessKey(), ctx.applicationId());

        try {
            ValidateApplicationResult result = useCase.handle(
                    new ValidateApplicationCommand(
                            ctx.applicationId(),
                            ctx.businessKey(),
                            ctx.processInstanceId(),
                            ctx.activityId()
                    )
            );

            execution.setVariable(WorkflowVariables.VALIDATION_STATUS, result.status().name());
            execution.setVariable(WorkflowVariables.VALIDATION_REASON, result.reason());

            if (result.status() == ValidationStatus.BUSINESS_REJECTED) {
                throw new BpmnError(
                        WorkflowErrors.APPLICATION_INVALID,
                        result.reason()
                );
            }
        } catch (KnownBusinessException ex) {
            throw new BpmnError(WorkflowErrors.APPLICATION_INVALID, ex.getMessage());
        } catch (TransientDependencyException ex) {
            // Let Camunda transaction fail; if async job, retry semantics apply.
            throw ex;
        }
    }
}
```

And supporting constants:

```java
public final class WorkflowVariables {
    public static final String APPLICATION_ID = "applicationId";
    public static final String VALIDATION_STATUS = "validationStatus";
    public static final String VALIDATION_REASON = "validationReason";

    private WorkflowVariables() {}
}

public final class WorkflowErrors {
    public static final String APPLICATION_INVALID = "APPLICATION_INVALID";

    private WorkflowErrors() {}
}
```

This pattern has several benefits:

- BPMN binds to stable bean name;
- variables are centralized;
- error codes are centralized;
- delegate logs correlation data;
- delegate is stateless;
- business logic lives in use case;
- technical exceptions flow into retry/incident behavior;
- business exceptions map to BPMN errors intentionally.

---

## 15. DelegateExecution: Useful but Dangerous

`DelegateExecution` gives access to process runtime context:

- process instance id;
- process definition id;
- business key;
- current activity id;
- current activity name;
- variables;
- tenant id;
- process engine services;
- event name for listeners;
- BPMN model element instance in some cases.

It is tempting to pass `DelegateExecution` everywhere:

```java
applicationService.doEverything(execution);
```

Avoid this.

Why?

- application service becomes Camunda-dependent;
- testing becomes harder;
- hidden variable access spreads;
- domain code can mutate process state accidentally;
- retry semantics become implicit;
- long-running contract becomes obscure.

Better:

```java
ValidateApplicationCommand command = ValidateApplicationCommand.from(execution);
ValidateApplicationResult result = useCase.handle(command);
result.writeTo(execution);
```

Boundary:

```text
Delegate may know Camunda.
Use case should not need to know Camunda.
Domain should not know Camunda.
```

---

## 16. Java 8 to Java 25 Considerations

Camunda 7 spans a long Java era. But not every Camunda 7 version supports every Java version. Treat Java compatibility as runtime/version-specific.

General design advice across Java 8–25:

### 16.1 Java 8 Compatible Delegate Style

If targeting old Camunda 7 estate on Java 8:

- avoid records;
- avoid pattern matching;
- avoid `var`;
- avoid text blocks;
- avoid switch expressions;
- avoid virtual threads;
- use explicit DTO classes;
- use SLF4J MDC carefully;
- use old Date/Calendar only if forced; otherwise use `java.time` available since Java 8.

Example:

```java
public final class WorkflowContext {
    private final String processInstanceId;
    private final String businessKey;
    private final String applicationId;

    public WorkflowContext(String processInstanceId, String businessKey, String applicationId) {
        this.processInstanceId = processInstanceId;
        this.businessKey = businessKey;
        this.applicationId = applicationId;
    }

    public static WorkflowContext from(DelegateExecution execution) {
        return new WorkflowContext(
                execution.getProcessInstanceId(),
                execution.getBusinessKey(),
                (String) execution.getVariable("applicationId")
        );
    }

    public String processInstanceId() { return processInstanceId; }
    public String businessKey() { return businessKey; }
    public String applicationId() { return applicationId; }
}
```

### 16.2 Java 17/21+ Style

If estate supports modern Java:

```java
public record WorkflowContext(
        String processInstanceId,
        String businessKey,
        String applicationId,
        String activityId
) {
    public static WorkflowContext from(DelegateExecution execution) {
        return new WorkflowContext(
                execution.getProcessInstanceId(),
                execution.getBusinessKey(),
                requiredString(execution, WorkflowVariables.APPLICATION_ID),
                execution.getCurrentActivityId()
        );
    }
}
```

Modern Java improves delegate clarity, but do not let language features hide process contract.

### 16.3 Java 25 Planning

For Java 25-era codebases, the bigger issue is not syntax. It is compatibility:

- Camunda 7 version support;
- Spring Boot generation;
- `javax` vs `jakarta` dependencies;
- application server compatibility;
- bytecode target;
- plugins and extension libraries;
- scripting engine availability;
- JAXB/JAX-WS legacy modules removed from JDK after Java 8;
- reflective access restrictions.

Rule:

> Model contract should be more stable than Java syntax trend.

A BPMN delegate name that stays stable for years is more valuable than using the newest Java feature inside workflow boundary code.

---

## 17. Listener Binding

Listeners are hooks attached to process lifecycle events.

### 17.1 Execution Listener

Execution listeners can react to lifecycle events such as start/end of activity or transition depending on placement.

Example:

```xml
<serviceTask id="validateApplication"
             camunda:delegateExpression="${validateApplicationDelegate}">
  <extensionElements>
    <camunda:executionListener event="start"
                               delegateExpression="${activityStartAuditListener}" />
    <camunda:executionListener event="end"
                               delegateExpression="${activityEndAuditListener}" />
  </extensionElements>
</serviceTask>
```

Java:

```java
@Component("activityStartAuditListener")
public final class ActivityStartAuditListener implements ExecutionListener {

    private final WorkflowAuditService auditService;

    public ActivityStartAuditListener(WorkflowAuditService auditService) {
        this.auditService = auditService;
    }

    @Override
    public void notify(DelegateExecution execution) {
        auditService.recordActivityStarted(
                execution.getProcessInstanceId(),
                execution.getBusinessKey(),
                execution.getCurrentActivityId()
        );
    }
}
```

### 17.2 Task Listener

Task listeners react to user task lifecycle events such as create, assignment, complete, delete.

Example:

```xml
<userTask id="reviewApplication"
          name="Review Application">
  <extensionElements>
    <camunda:taskListener event="create"
                          delegateExpression="${reviewTaskCreatedListener}" />
    <camunda:taskListener event="complete"
                          delegateExpression="${reviewTaskCompletedListener}" />
  </extensionElements>
</userTask>
```

Java:

```java
@Component("reviewTaskCreatedListener")
public final class ReviewTaskCreatedListener implements TaskListener {

    private final AssignmentService assignmentService;

    public ReviewTaskCreatedListener(AssignmentService assignmentService) {
        this.assignmentService = assignmentService;
    }

    @Override
    public void notify(DelegateTask task) {
        String applicationId = (String) task.getVariable(WorkflowVariables.APPLICATION_ID);
        String assignee = assignmentService.findReviewer(applicationId);
        task.setAssignee(assignee);
    }
}
```

### 17.3 Listener Abuse

Listeners are attractive because they keep BPMN diagram visually clean. But they can hide important behavior.

Anti-pattern:

```text
User task looks simple on diagram
        |
        +-- task create listener creates audit row
        +-- task create listener assigns reviewer
        +-- task create listener sends email
        +-- task complete listener validates form
        +-- task complete listener mutates case status
        +-- task complete listener calls remote API
```

The diagram no longer tells the truth.

Rule:

> Listener should usually implement cross-cutting or lifecycle-adjacent behavior, not core process progression.

Good listener use:

- audit lifecycle hook;
- assignment on task create;
- metrics;
- correlation id enrichment;
- defensive validation;
- notification outbox if explicitly accepted as lifecycle event.

Bad listener use:

- core approval decision;
- hidden gateway logic;
- remote side-effect with no async boundary;
- creating many variables secretly;
- silently completing other tasks;
- mutating unrelated aggregate state.

---

## 18. Error Semantics in Delegation Code

Delegation code can fail in different ways:

| Failure | Java behavior | Camunda behavior |
|---|---|---|
| Technical transient failure | throw RuntimeException | rollback; if async job then retry/incident |
| Business expected error | throw `BpmnError` | caught by matching BPMN error boundary/event |
| Validation failure before wait state | throw exception | rollback current transaction |
| Optimistic lock conflict | engine exception | job retry or API error |
| Expression evaluation failure | process engine exception | rollback/job fail |
| Bean not found | expression exception | rollback/job fail |
| Class not found | deployment/execution failure | deployment or runtime fail depending case |

Camunda documentation states that `BpmnError` can be thrown from delegation code such as Java Delegate, Execution Listener, and Task Listener.

### 18.1 Do Not Use `BpmnError` for Technical Failures

Wrong:

```java
try {
    remoteClient.call();
} catch (IOException ex) {
    throw new BpmnError("REMOTE_FAILED");
}
```

This turns retryable infrastructure failure into business path.

Better:

```java
try {
    remoteClient.call();
} catch (IOException ex) {
    throw new TransientDependencyException("Remote service unavailable", ex);
}
```

Then put async boundary on the task if retry should be handled by job executor.

### 18.2 Use `BpmnError` for Expected Business Alternative

Example:

```java
if (eligibilityResult.isRejected()) {
    throw new BpmnError("NOT_ELIGIBLE", eligibilityResult.reason());
}
```

BPMN:

```xml
<boundaryEvent id="notEligibleBoundary"
               attachedToRef="checkEligibility">
  <errorEventDefinition errorRef="notEligibleError" />
</boundaryEvent>
```

---

## 19. Runtime Binding and Retry Safety

A delegate can execute more than once.

Reasons:

- async job failed and retried;
- node crashed after external side-effect but before DB commit;
- lock expired and another node retried;
- optimistic locking occurred;
- operator retried incident;
- process instance was modified/restarted;
- duplicate external signal/message triggered path.

Therefore delegate code must be retry-safe.

### 19.1 Dangerous Delegate

```java
@Component("sendEmailDelegate")
public final class SendEmailDelegate implements JavaDelegate {

    private final EmailClient emailClient;

    @Override
    public void execute(DelegateExecution execution) {
        String email = (String) execution.getVariable("email");
        emailClient.send(email, "Your application was approved");
        execution.setVariable("emailSent", true);
    }
}
```

Failure scenario:

```text
send email succeeds
engine tries to flush variable emailSent=true
DB commit fails / node crashes
job retried
email sent again
```

### 19.2 Safer Outbox Delegate

```java
@Component("createApprovalEmailOutboxDelegate")
public final class CreateApprovalEmailOutboxDelegate implements JavaDelegate {

    private final NotificationOutboxRepository outboxRepository;

    @Override
    public void execute(DelegateExecution execution) {
        String businessKey = execution.getBusinessKey();
        String applicationId = (String) execution.getVariable(WorkflowVariables.APPLICATION_ID);

        String idempotencyKey = "APPROVAL_EMAIL:" + businessKey;

        outboxRepository.insertIfAbsent(new NotificationOutboxCommand(
                idempotencyKey,
                applicationId,
                "APPLICATION_APPROVED"
        ));

        execution.setVariable("approvalEmailQueued", true);
    }
}
```

The email sender later processes outbox row with idempotency.

---

## 20. BPMN XML Contract Example

A clear, maintainable service task:

```xml
<bpmn:serviceTask id="validateApplication"
                  name="Validate Application"
                  camunda:delegateExpression="${validateApplicationDelegate}"
                  camunda:asyncBefore="true"
                  camunda:exclusive="true">
  <bpmn:extensionElements>
    <camunda:failedJobRetryTimeCycle>R3/PT5M</camunda:failedJobRetryTimeCycle>
  </bpmn:extensionElements>
</bpmn:serviceTask>
```

This communicates:

- stable activity id: `validateApplication`;
- stable delegate contract: `validateApplicationDelegate`;
- durable boundary before execution: `asyncBefore=true`;
- process-instance serialization hint: `exclusive=true`;
- retry policy: three retries separated by five minutes.

A poor service task:

```xml
<bpmn:serviceTask id="task42"
                  name="Do Stuff"
                  camunda:expression="${applicationService.doStuff(execution)}" />
```

Problems:

- meaningless activity id;
- vague name;
- direct application service exposure;
- no async boundary;
- no retry policy;
- hidden variable contract;
- unclear failure semantics.

---

## 21. Contract Constants and Model Stability

Treat BPMN IDs and delegate names as code-level constants.

```java
public final class WorkflowActivities {
    public static final String VALIDATE_APPLICATION = "validateApplication";
    public static final String CALCULATE_RISK = "calculateRisk";
    public static final String REVIEW_APPLICATION = "reviewApplication";

    private WorkflowActivities() {}
}

public final class WorkflowDelegates {
    public static final String VALIDATE_APPLICATION = "validateApplicationDelegate";
    public static final String CALCULATE_RISK = "calculateRiskDelegate";

    private WorkflowDelegates() {}
}
```

This helps:

- tests reference stable ids;
- migration plans use stable activity ids;
- monitoring labels remain consistent;
- incident playbook is easier;
- refactor becomes controlled.

But do not overdo it by generating BPMN from constants unless your team has a strong model governance workflow.

---

## 22. Input/Output Mapping vs Delegate Field Injection

Suppose you need to reuse a delegate with different configuration.

Option A: field injection.

```xml
<camunda:field name="targetStatus" stringValue="APPROVED" />
```

Option B: input parameter.

```xml
<camunda:inputOutput>
  <camunda:inputParameter name="targetStatus">APPROVED</camunda:inputParameter>
</camunda:inputOutput>
```

The input mapping approach is usually clearer because the value becomes part of execution variable context rather than mutable delegate field state.

Recommended rule:

| Configuration type | Prefer |
|---|---|
| Static technical config for non-Spring class delegate | Field injection acceptable |
| Runtime business parameter | Input/output mapping |
| Spring singleton bean | Avoid field injection |
| Shared reusable command | Explicit variable/DTO contract |
| Sensitive config | Application config/secrets, not BPMN XML |

---

## 23. Expression Security

Expressions can call methods. Scripts can access objects. Spring integration may expose beans.

This is a security boundary.

Risks:

- BPMN model author can call unintended bean methods;
- malicious process deployment can invoke dangerous services;
- script task may execute unreviewed logic;
- expression can expose sensitive data;
- admin deployment rights become code execution rights;
- all-bean exposure increases attack surface.

Controls:

1. Restrict who can deploy BPMN.
2. Limit exposed beans.
3. Use process application boundaries.
4. Review BPMN XML in pull requests.
5. Disable or restrict scripting if not needed.
6. Avoid exposing repositories/admin services to expressions.
7. Treat BPMN as executable artifact.
8. Use code scanning for suspicious expression usage.
9. Separate modeler-facing templates from raw XML freedom.
10. Have production deployment governance.

---

## 24. Versioning: Long-Running Instances and Binding Drift

Camunda process instances can run for days, months, or years.

The process definition version is fixed per instance, but Java code deployment may move forward.

Scenario:

```text
Day 1:
  process definition v1 deployed
  service task uses ${validateApplicationDelegate}
  delegate expects variable applicationId

Day 90:
  application code changed
  validateApplicationDelegate now expects applicationRef and applicantProfileId

Day 91:
  old v1 process instance reaches validateApplication
  delegate fails because variables do not match new expectation
```

The BPMN version is old, but bean name resolves to new code.

This is one of the most important Camunda 7 enterprise hazards.

### 24.1 Mitigation Patterns

#### Pattern 1: Backward-Compatible Delegate

```java
String applicationId = optionalString(execution, "applicationId")
        .orElseGet(() -> resolveFromNewVariables(execution));
```

Useful for small transitions.

#### Pattern 2: Versioned Delegate Bean Names

```xml
camunda:delegateExpression="${validateApplicationV1Delegate}"
```

Later:

```xml
camunda:delegateExpression="${validateApplicationV2Delegate}"
```

Keeps old process instances bound to old adapter.

Trade-off: more beans to maintain.

#### Pattern 3: Stable Delegate + Versioned Use Case Internally

```java
@Component("validateApplicationDelegate")
public final class ValidateApplicationDelegate implements JavaDelegate {

    private final ValidateApplicationV1UseCase v1;
    private final ValidateApplicationV2UseCase v2;

    @Override
    public void execute(DelegateExecution execution) {
        String processDefinitionKey = execution.getProcessDefinitionId();
        String modelVersion = (String) execution.getVariable("workflowSchemaVersion");

        if ("1".equals(modelVersion)) {
            v1.handle(...);
        } else {
            v2.handle(...);
        }
    }
}
```

Trade-off: delegate becomes router.

#### Pattern 4: Migrate Process Instances Before Removing Old Contract

Use process instance migration when model contract changes. But migration only maps execution state; it does not magically convert every variable and Java contract unless you design it.

#### Pattern 5: Process Archive / Process Application Version Isolation

In shared engine/app server deployments, keep process application versions isolated longer. Operationally heavier but safer for long-running estate.

---

## 25. Runtime Binding Failure Modes

### 25.1 Bean Not Found

Symptoms:

```text
Cannot resolve identifier 'validateApplicationDelegate'
Unknown property used in expression
```

Causes:

- bean name mismatch;
- bean not exposed to process engine;
- Spring context not available;
- process app not registered;
- shared engine resolving against wrong application;
- BPMN deployed to engine without matching application;
- typo in expression.

Diagnostics:

1. Check BPMN XML expression.
2. Check Spring bean name.
3. Check `beans` exposure map.
4. Check process application deployment.
5. Check whether job executor node has the application/classes.
6. Check deployment-aware job executor setting for heterogeneous cluster.

### 25.2 Class Not Found

Symptoms:

```text
ClassNotFoundException: com.example.workflow.ValidateApplicationDelegate
```

Causes:

- `camunda:class` package changed;
- delegate class not packaged;
- wrong classloader;
- process deployed to remote/shared engine without class;
- old process definition references deleted class.

Mitigation:

- prefer delegate expression in Spring/CDI systems;
- retain compatibility classes for long-running definitions;
- avoid deleting old delegates until all old instances complete/migrate;
- use versioned process applications.

### 25.3 Method Not Found

Symptoms:

```text
Method not found: applicationService.validate(...)
```

Causes:

- method renamed;
- parameter changed;
- overloaded method ambiguity;
- bean proxied and method not visible;
- expression evaluated against wrong bean.

Mitigation:

- avoid method expressions for core commands;
- use JavaDelegate interface;
- keep facade methods stable;
- test BPMN deployment and execution path.

### 25.4 Concurrent Modification of Delegate Fields

Symptoms:

- wrong template used;
- wrong endpoint used;
- intermittent failures;
- only appears under load;
- cannot reproduce locally.

Likely cause:

- field injection into singleton delegate bean.

Mitigation:

- remove mutable fields;
- use one bean per operation;
- use input/output mapping;
- use prototype scope only if fully understood;
- make delegates stateless.

---

## 26. Testing Runtime Binding

You need tests that validate not only Java code but BPMN binding.

### 26.1 Deployment Test

```java
@Test
void processModelDeploys() {
    repositoryService.createDeployment()
            .addClasspathResource("processes/application-review.bpmn")
            .deploy();
}
```

This catches some XML/model issues but not all runtime resolution issues.

### 26.2 Execution Path Test

```java
@Test
void shouldExecuteValidationDelegate() {
    Map<String, Object> variables = new HashMap<>();
    variables.put("applicationId", "APP-001");

    ProcessInstance pi = runtimeService.startProcessInstanceByKey(
            "applicationReview",
            "APP-001",
            variables
    );

    // Assert process reached expected wait state or ended.
}
```

### 26.3 Bean Resolution Test

In Spring Boot integration test:

```java
@SpringBootTest
class WorkflowBindingTest {

    @Autowired RuntimeService runtimeService;
    @Autowired TaskService taskService;

    @Test
    void validateApplicationDelegateIsResolvableFromBpmn() {
        runtimeService.startProcessInstanceByKey(
                "applicationReview",
                "APP-001",
                Map.of("applicationId", "APP-001")
        );

        // Continue/assert expected state.
    }
}
```

### 26.4 Contract Test for Variable Names

```java
@Test
void validateApplicationRequiresApplicationId() {
    DelegateExecution execution = mock(DelegateExecution.class);
    when(execution.getVariable("applicationId")).thenReturn(null);

    assertThrows(IllegalArgumentException.class,
            () -> delegate.execute(execution));
}
```

Better yet, test via workflow context parser:

```java
@Test
void workflowContextRejectsMissingApplicationId() {
    DelegateExecution execution = mock(DelegateExecution.class);
    when(execution.getVariable(WorkflowVariables.APPLICATION_ID)).thenReturn(null);

    assertThrows(MissingWorkflowVariableException.class,
            () -> WorkflowContext.from(execution));
}
```

---

## 27. Recommended Enterprise Conventions

### 27.1 Delegate Naming

```text
<verb><DomainObject><Delegate>
```

Examples:

```text
validateApplicationDelegate
calculateRiskScoreDelegate
assignCaseOfficerDelegate
createNotificationOutboxDelegate
recordInspectionOutcomeDelegate
```

### 27.2 BPMN Activity ID Naming

```text
<verb><DomainObject>
```

Examples:

```text
validateApplication
calculateRiskScore
assignCaseOfficer
reviewApplication
approveApplication
notifyApplicant
```

Avoid:

```text
task1
autoTask
serviceTask_13
Gateway_0j1sk9
```

### 27.3 Variable Naming

Use stable domain names:

```text
applicationId
caseId
applicantId
riskScore
reviewDecision
approvalDecision
slaDeadline
```

Avoid technical names:

```text
x
data
payload
temp
flag
status2
```

### 27.4 Error Code Naming

```text
APPLICATION_INVALID
CASE_NOT_ELIGIBLE
APPROVAL_REJECTED
DOCUMENT_INCOMPLETE
PAYMENT_REQUIRED
```

### 27.5 Bean Exposure Policy

Expose only workflow adapter beans:

```text
Allowed:
  validateApplicationDelegate
  calculateRiskScoreDelegate
  assignCaseOfficerDelegate
  createNotificationOutboxDelegate

Not allowed:
  userRepository
  dataSource
  transactionManager
  adminService
  internalRestClient
  passwordEncoder
```

---

## 28. Practical Review Checklist

Before approving BPMN + Java changes, ask:

### Binding

- Does BPMN use `camunda:class`, `delegateExpression`, or `expression`?
- Is the binding stable across refactor?
- Is bean name explicitly declared?
- Is this binding part of long-running process contract?

### Variables

- What variables does the delegate read?
- What variables does it write?
- Are variable names centralized?
- Are types stable and serialization-safe?

### Transaction

- Does delegate perform external side effects?
- Is there an async boundary before the delegate?
- Is the operation idempotent?
- Is outbox/inbox needed?

### Error

- Which errors are business errors?
- Which errors are technical failures?
- Does BPMN catch `BpmnError` intentionally?
- Are technical exceptions allowed to trigger retry?

### Concurrency

- Is delegate stateless?
- Is field injection avoided on singleton beans?
- Can two process instances execute this delegate concurrently?
- Can same process instance execute parallel paths that touch same aggregate?

### Security

- Are all Spring beans exposed?
- Can model authors call sensitive services?
- Who can deploy BPMN?
- Are script tasks allowed?

### Versioning

- What happens to old process instances?
- Can old model still call new delegate safely?
- Are versioned delegates needed?
- Do migration plans include variable contract changes?

---

## 29. Mini Case Study: Regulatory Application Review

Imagine process:

```text
Start Application Review
    -> Validate Application
    -> Calculate Risk Score
    -> Assign Reviewer
    -> Review Application User Task
    -> Approved?
        -> Create License
        -> Notify Applicant
        -> End
      else
        -> Notify Rejection
        -> End
```

Naive BPMN:

```xml
<serviceTask id="task1" camunda:expression="${applicationService.validate(execution)}" />
<serviceTask id="task2" camunda:expression="${riskService.calculate(execution)}" />
<serviceTask id="task3" camunda:expression="${assignmentService.assign(execution)}" />
```

Problems:

- unclear activity ids;
- direct app service exposure;
- no stable workflow adapter contract;
- hard to test BPMN binding;
- no async boundaries;
- hidden variable contracts;
- no retry strategy;
- long-running versioning risk.

Improved BPMN:

```xml
<serviceTask id="validateApplication"
             name="Validate Application"
             camunda:delegateExpression="${validateApplicationDelegate}"
             camunda:asyncBefore="true"
             camunda:exclusive="true" />

<serviceTask id="calculateRiskScore"
             name="Calculate Risk Score"
             camunda:delegateExpression="${calculateRiskScoreDelegate}"
             camunda:asyncBefore="true"
             camunda:exclusive="true" />

<serviceTask id="assignReviewer"
             name="Assign Reviewer"
             camunda:delegateExpression="${assignReviewerDelegate}"
             camunda:asyncBefore="true"
             camunda:exclusive="true" />
```

Java adapter:

```java
@Component("calculateRiskScoreDelegate")
public final class CalculateRiskScoreDelegate implements JavaDelegate {

    private final CalculateRiskScoreUseCase useCase;

    public CalculateRiskScoreDelegate(CalculateRiskScoreUseCase useCase) {
        this.useCase = useCase;
    }

    @Override
    public void execute(DelegateExecution execution) {
        WorkflowContext ctx = WorkflowContext.from(execution);

        RiskScoreResult result = useCase.handle(new CalculateRiskScoreCommand(
                ctx.applicationId(),
                ctx.businessKey(),
                ctx.processInstanceId()
        ));

        execution.setVariable(WorkflowVariables.RISK_SCORE, result.score());
        execution.setVariable(WorkflowVariables.RISK_LEVEL, result.level().name());
    }
}
```

The improved design is not just cleaner. It is operationally safer.

---

## 30. Anti-Patterns

### 30.1 Expression Soup

```xml
${a.b(c.d(e.f(execution.getVariable('x'))))}
```

Problem: logic hidden in expression.

Fix: use delegate/use case.

### 30.2 Business Logic in Listener

Problem: diagram lies.

Fix: model core step explicitly or delegate from service task.

### 30.3 Mutable Singleton Delegate

Problem: thread safety failure.

Fix: stateless delegate; no field injection into singleton.

### 30.4 Direct Repository Access from BPMN Expression

```xml
${applicationRepository.save(application)}
```

Problem: persistence semantics leak into model.

Fix: application use case behind workflow adapter.

### 30.5 Passing `DelegateExecution` Everywhere

Problem: Camunda infects domain/application layer.

Fix: translate to command/result DTO at boundary.

### 30.6 Deleting Old Delegate Class Too Early

Problem: old process instances fail.

Fix: keep compatibility until instances complete or migrate.

### 30.7 All Beans Exposed to BPMN

Problem: model deployment becomes broad application execution permission.

Fix: restrict exposed beans.

---

## 31. Mental Model Summary

Think of Camunda 7 runtime binding like this:

```text
BPMN process definition
    = executable model
    = activity graph
    = transaction metadata
    = retry metadata
    = Java binding metadata
    = variable contract metadata
```

Every expression, delegate name, class name, listener, topic, variable, and error code is part of a long-lived contract.

The top 1% skill is not merely knowing how to write:

```java
implements JavaDelegate
```

The top 1% skill is knowing what the delegate means operationally:

- What transaction is it part of?
- Can it run twice?
- Can it run concurrently?
- What does it read/write?
- What is its rollback behavior?
- What happens if code changes after model deployment?
- What if the bean disappears?
- What if an old process instance reaches it six months later?
- What if model author can call arbitrary Spring beans?
- What if exception is business vs technical?

---

## 32. Production Checklist

Use this as baseline for Camunda 7 Java runtime binding:

- Prefer `delegateExpression` over `camunda:class` in Spring/CDI applications.
- Use explicit stable bean names.
- Treat delegate names as public workflow contract.
- Keep delegates stateless.
- Do not use field injection on singleton Spring beans.
- Avoid direct method expression for core business operations.
- Use input/output mapping for activity-local parameters.
- Centralize variable names and BPMN error codes.
- Do not pass `DelegateExecution` into domain layer.
- Map execution to command DTO, then result DTO back to execution.
- Use `BpmnError` only for expected business alternatives.
- Let technical exceptions fail/retry/incident.
- Put async boundary before retryable side-effectful work.
- Make side effects idempotent or outbox-backed.
- Restrict exposed Spring beans.
- Review BPMN XML as executable code.
- Test actual BPMN binding, not just Java classes.
- Keep compatibility for old process definitions.
- Plan versioned delegates for long-running contracts.
- Understand classloader and process application boundaries.

---

## 33. What Comes Next

This part explained how BPMN binds to Java code and beans.

The next part, `part-010`, goes deeper into extension points:

- JavaDelegate;
- ExecutionListener;
- TaskListener;
- ParseListener;
- Engine Plugin;
- extension discipline;
- listener lifecycle;
- where to put policy vs business logic;
- how to design extension points without creating invisible workflow behavior.

---

## 34. References

- Camunda 7.24 documentation — Expression Language: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/expression-language/`
- Camunda 7.24 documentation — Delegation Code: `https://docs.camunda.org/manual/7.24/user-guide/process-engine/delegation-code/`
- Camunda 7.24 documentation — Spring Beans in Processes: `https://docs.camunda.org/manual/7.24/user-guide/spring-framework-integration/expressions/`
- Camunda 7.24 Javadocs — `org.camunda.bpm.engine.delegate`: `https://docs.camunda.org/javadoc/camunda-bpm-platform/7.24/org/camunda/bpm/engine/delegate/package-summary.html`

---

## 35. Status

`part-009` selesai.

Seri belum selesai. Lanjut ke:

```text
learn-java-camunda-7-bpm-platform-engineering-part-010.md
```

Topik berikutnya:

```text
JavaDelegate, ExecutionListener, TaskListener, ParseListener, dan Extension Point Discipline
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-008.md">⬅️ Variable System Deep Dive: Serialization, Typed Values, Spin, JSON/XML, Object Variables</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-camunda-7-bpm-platform-engineering-part-010.md">Part 010 — JavaDelegate, ExecutionListener, TaskListener, ParseListener, dan Extension Point Discipline ➡️</a>
</div>
