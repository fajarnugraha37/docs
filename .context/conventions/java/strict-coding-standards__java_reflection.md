# Strict Coding Standards — Java Reflection

> **Purpose**: This document defines mandatory rules for LLMs, code agents, and human contributors when implementing Java reflection, runtime introspection, annotation scanning, dynamic invocation, proxies, `MethodHandle`, `VarHandle`, and class loading.
>
> **Scope**: Java 11, Java 17, Java 21, and Java 25 codebases. Applies to application code, framework integration, libraries, test utilities, serializers, mappers, plugins, and runtime metadata tools.
>
> **Mode**: Strict. Reflection is not a convenience shortcut. It is a boundary that weakens static reasoning, type safety, encapsulation, performance predictability, security review, and toolability.

---

## 0. Core Principle

Reflection is allowed only when normal Java constructs cannot express the requirement cleanly.

A code agent must not use reflection merely to avoid writing explicit code, avoid dependency injection, avoid polymorphism, bypass visibility, access private state, construct arbitrary classes, or make a generic solution look shorter.

Every reflective implementation must answer:

1. **Why reflection is necessary**.
2. **Which classes/packages/members are allowed**.
3. **How access is constrained**.
4. **How module boundaries are respected**.
5. **How untrusted input is prevented from choosing types or members**.
6. **How errors are mapped into stable application failures**.
7. **How performance impact is bounded**.
8. **How behavior is tested under the target Java baseline**.

If these cannot be answered, do not use reflection.

---

## 1. Version Compatibility Matrix

| Feature / Behavior              |        Java 11 |                         Java 17 |              Java 21 |              Java 25 | Rule                                                         |
| ------------------------------- | -------------: | ------------------------------: | -------------------: | -------------------: | ------------------------------------------------------------ |
| `java.lang.reflect`             |            Yes |                             Yes |                  Yes |                  Yes | Restricted                                                   |
| `Class.forName`                 |            Yes |                             Yes |                  Yes |                  Yes | Restricted to allow-listed types                             |
| `setAccessible(true)`           |            Yes | Strongly constrained by modules | Strongly constrained | Strongly constrained | Forbidden by default                                         |
| Illegal access to JDK internals | Warned/limited | Strong encapsulation by default | Strong encapsulation | Strong encapsulation | Forbidden                                                    |
| `MethodHandle`                  |            Yes |                             Yes |                  Yes |                  Yes | Preferred for repeated dynamic invocation when justified     |
| `VarHandle`                     |            Yes |                             Yes |                  Yes |                  Yes | Restricted to low-level libraries/concurrency-sensitive code |
| Dynamic proxies                 |            Yes |                             Yes |                  Yes |                  Yes | Allowed for interface-based cross-cutting behavior           |
| Hidden classes                  |             No |                             Yes |                  Yes |                  Yes | Framework/library only                                       |
| Records reflection              |             No |                             Yes |                  Yes |                  Yes | Allowed for metadata only                                    |
| Sealed type reflection          |             No |                             Yes |                  Yes |                  Yes | Allowed for metadata only                                    |
| Runtime annotation scanning     |            Yes |                             Yes |                  Yes |                  Yes | Allowed with bounded package scope                           |

### 1.1 Baseline Rule

Generated code must declare the Java baseline and must not assume illegal reflective access will work across Java versions.

Example:

```text
Baseline: Java 17
Reflection policy: no access to JDK internals; no setAccessible(true); explicit module opens only if approved.
```

---

## 2. Absolute Rules

### 2.1 Forbidden by Default

The following are forbidden unless an approved architecture note explicitly allows them:

1. using reflection to access or mutate private fields of domain/application objects;
2. using `setAccessible(true)` or `trySetAccessible()` to bypass normal Java access control;
3. using reflection against JDK internal packages such as `sun.*`, `com.sun.*`, `jdk.internal.*`, or non-exported modules;
4. using user input to choose class names, method names, field names, constructors, packages, modules, or classpath locations;
5. invoking arbitrary methods from request parameters, message payloads, headers, database rows, configuration strings, or scripts;
6. mass-scanning the full classpath at application startup without a bounded package allow-list;
7. silently swallowing `ReflectiveOperationException`;
8. converting reflective failures into generic `RuntimeException` without context;
9. creating objects reflectively instead of using constructors, factories, dependency injection, or service loader;
10. writing a reflection-based mapper when an explicit mapper is clearer and safer;
11. using reflection to bypass immutability, validation, constructor invariants, records, sealed type restrictions, or framework lifecycle rules;
12. assuming reflective code is portable across Java 11, 17, 21, and 25 without testing;
13. exposing reflection capability as a public API;
14. using reflection to call non-public methods in production because tests need it;
15. caching reflective objects in mutable global maps without lifecycle and classloader leak analysis.

### 2.2 Mandatory for Any Reflective Code

Any reflective implementation must include or reference a design note:

```text
Reflection Design Note
- Requirement that cannot be solved statically:
- Java baseline:
- Allowed package/class/member set:
- Disallowed package/class/member set:
- Trust boundary:
- Access policy:
- Module policy:
- Error mapping:
- Caching/lifecycle:
- Performance impact:
- Tests:
```

If this note does not exist, the reflective implementation is incomplete.

---

## 3. Reflection Decision Protocol

Before writing reflective code, apply this decision protocol in order:

1. Can normal polymorphism solve it?
2. Can a strategy, factory, registry, or dependency injection solve it?
3. Can `ServiceLoader` solve plugin discovery?
4. Can annotation processing or generated code solve it at build time?
5. Can explicit mapping solve it with better auditability?
6. Can framework-provided extension points solve it?
7. Is runtime reflection still necessary?

Only step 7 allows reflection.

### 3.1 Reflection Justification Template

```text
Reflection Justification
- Static alternative considered:
- Why static alternative was rejected:
- Runtime metadata required:
- Allowed targets:
- Input source:
- Safety constraints:
- Failure behavior:
- Tests proving behavior:
```

---

## 4. Allowed Use Cases

Reflection is allowed when one of the following is true and the implementation is constrained:

1. framework integration that requires runtime metadata;
2. serialization/deserialization libraries with explicit DTO allow-lists;
3. dependency injection/container bootstrapping with bounded package scanning;
4. annotation-driven metadata discovery;
5. test-only inspection utilities under test source set;
6. migration tooling, static analysis tooling, or documentation generation;
7. plugin discovery through approved mechanism such as `ServiceLoader`;
8. library code that must support user-provided types but enforces allow-lists and safe constructors;
9. performance-sensitive repeated dynamic invocation using `MethodHandle` after upfront validation;
10. low-level framework code that must interact with records, sealed classes, or annotations as metadata.

Allowed does not mean unrestricted. Each use case still requires a target allow-list and error policy.

---

## 5. Preferred Alternatives

| Goal                           | Prefer                              | Avoid                                |
| ------------------------------ | ----------------------------------- | ------------------------------------ |
| Select behavior dynamically    | interface + strategy registry       | method name from string              |
| Instantiate implementation     | factory / DI / `ServiceLoader`      | `Class.forName(...).newInstance()`   |
| Map DTO to domain              | explicit mapper / generated mapper  | reflection over fields               |
| Read annotations               | bounded annotation scanning         | classpath-wide scanning              |
| Invoke repeated dynamic method | validated `MethodHandle`            | repeated `Method.invoke` in hot path |
| Access fields                  | public API / constructor / accessor | private field mutation               |
| Bind config                    | explicit config class               | arbitrary reflective binding         |
| Discover plugins               | `ServiceLoader`                     | scanning every jar                   |

---

## 6. Class Loading Rules

### 6.1 `Class.forName` Policy

`Class.forName` is restricted.

Allowed only when:

1. class name comes from trusted project-owned configuration;
2. class name is validated against an allow-list or approved package prefix;
3. class implements/extends an expected public type;
4. constructor and lifecycle are controlled;
5. failure is mapped clearly.

Forbidden:

```java
Class<?> type = Class.forName(request.getParameter("class"));
```

Allowed pattern:

```java
private static final Map<String, Class<? extends PaymentHandler>> HANDLERS = Map.of(
    "CARD", CardPaymentHandler.class,
    "BANK_TRANSFER", BankTransferPaymentHandler.class
);

PaymentHandler createHandler(String code) {
    Class<? extends PaymentHandler> type = HANDLERS.get(code);
    if (type == null) {
        throw new UnsupportedPaymentHandlerException(code);
    }
    return instantiateApprovedHandler(type);
}
```

### 6.2 Classloader Safety

If reflection caches `Class`, `Method`, `Field`, or `Constructor`, the code must consider classloader lifecycle.

Rules:

1. Do not store arbitrary `Class<?>` keys in static maps in redeployable application servers unless cache lifecycle is explicit.
2. Prefer `ClassValue<T>` for per-class caches.
3. Clear caches on component shutdown if classloader unloading matters.
4. Do not cache classloader references from request/application plugins unless owned.
5. Do not scan plugin classloaders from application classloaders without lifecycle documentation.

---

## 7. Constructor and Object Creation Rules

### 7.1 Constructor Access

Preferred order:

1. normal constructor/factory call;
2. DI container;
3. `ServiceLoader`;
4. public no-arg constructor discovered reflectively;
5. approved non-public constructor access only for framework internals.

Forbidden:

```java
Object instance = clazz.getDeclaredConstructor().newInstance(); // arbitrary clazz
```

Required checks:

```java
private static <T> T instantiateAllowed(Class<? extends T> type, Class<T> expectedType) {
    if (!expectedType.isAssignableFrom(type)) {
        throw new IllegalArgumentException("Type does not implement " + expectedType.getName());
    }
    if (!Modifier.isPublic(type.getModifiers())) {
        throw new IllegalArgumentException("Type must be public: " + type.getName());
    }
    try {
        Constructor<? extends T> ctor = type.getConstructor();
        return ctor.newInstance();
    } catch (ReflectiveOperationException ex) {
        throw new ComponentInstantiationException(type.getName(), ex);
    }
}
```

### 7.2 Invariant Safety

Reflective construction must not bypass constructor validation.

Forbidden:

1. `Unsafe.allocateInstance` for application objects;
2. setting private fields after construction to create invalid intermediate states;
3. constructing records without canonical constructor semantics;
4. mutating final fields reflectively;
5. creating JPA/domain entities reflectively outside framework-controlled persistence.

---

## 8. Field Access Rules

### 8.1 Private Field Access

Private field access is forbidden by default.

Do not use reflection to:

1. read domain state that has no accessor;
2. mutate private fields;
3. reset final fields;
4. bypass validation;
5. implement business logic;
6. test private implementation details.

If metadata is needed, inspect field annotations/types but do not read/write values unless the framework owns the model contract.

### 8.2 Public Field Access

Public field reflection is still restricted. Prefer accessors or explicit APIs.

If public fields are used for framework DTO binding:

1. DTO must be isolated from domain model;
2. allowed fields must be enumerated;
3. unknown fields must have explicit policy;
4. sensitive fields must be excluded;
5. tests must cover binding and exclusion.

---

## 9. Method Invocation Rules

### 9.1 `Method.invoke` Policy

`Method.invoke` is allowed only after validating:

1. declaring class;
2. method name;
3. parameter types;
4. return type;
5. visibility;
6. annotation or marker interface;
7. idempotency/failure behavior if invoked from message/request handling.

Forbidden:

```java
Method method = target.getClass().getMethod(request.getParameter("action"));
method.invoke(target);
```

Allowed pattern:

```java
private static final Map<String, Method> APPROVED_ACTIONS = loadApprovedActions();

Object invokeApproved(Object target, String actionCode, Object arg) {
    Method method = APPROVED_ACTIONS.get(actionCode);
    if (method == null) {
        throw new UnsupportedActionException(actionCode);
    }
    try {
        return method.invoke(target, arg);
    } catch (InvocationTargetException ex) {
        Throwable cause = ex.getCause();
        throw ActionInvocationException.from(actionCode, cause);
    } catch (IllegalAccessException ex) {
        throw new ActionInvocationException(actionCode, ex);
    }
}
```

### 9.2 Exception Handling

Never leak raw reflection exceptions to API clients.

Required mapping:

| Reflection exception          | Meaning                        | Mapping                                   |
| ----------------------------- | ------------------------------ | ----------------------------------------- |
| `ClassNotFoundException`      | missing configured type        | startup/configuration error               |
| `NoSuchMethodException`       | incompatible contract          | startup/configuration error               |
| `IllegalAccessException`      | access policy violation        | implementation/configuration error        |
| `InvocationTargetException`   | target method failed           | unwrap and map domain/application failure |
| `InstantiationException`      | invalid type construction      | configuration error                       |
| `InaccessibleObjectException` | module encapsulation violation | migration/configuration error             |

Do not log only the wrapper exception. Preserve the target cause.

---

## 10. `setAccessible` and Module Boundary Rules

### 10.1 Default Rule

`setAccessible(true)` and `trySetAccessible()` are forbidden by default.

They may be approved only for:

1. framework/library internals;
2. test utilities that do not ship to production;
3. migration tooling;
4. code generation fallback with explicit warning;
5. legacy compatibility where no public API exists and a removal plan is documented.

### 10.2 Module Rules

For Java 9+ modular behavior:

1. Do not rely on illegal access to JDK internals.
2. Do not add broad `--add-opens` or `--add-exports` as a hidden fix.
3. If `--add-opens` is required, it must be documented as a runtime contract.
4. Prefer public supported APIs.
5. Migration from Java 8/11 to 17+ must remove illegal reflective access, not merely suppress errors.

Forbidden runtime args by default:

```text
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.util=ALL-UNNAMED
--add-exports java.base/jdk.internal.misc=ALL-UNNAMED
```

Allowed only with explicit compatibility note and removal date.

---

## 11. `MethodHandle` and `VarHandle` Rules

### 11.1 `MethodHandle`

Use `MethodHandle` when:

1. dynamic invocation is justified;
2. target is validated once;
3. invocation happens frequently;
4. type signature is stable;
5. performance matters.

Rules:

1. Resolve handle once and cache safely.
2. Prefer typed handles over generic `Object...` style invocation.
3. Do not use `privateLookupIn` to bypass encapsulation without approval.
4. Keep lookup scope narrow.
5. Document failure behavior if method signature changes.

### 11.2 `VarHandle`

`VarHandle` is restricted to low-level libraries, concurrency-sensitive structures, serialization frameworks, or performance-critical infrastructure.

Forbidden for ordinary domain/application code.

Allowed only when the code documents:

1. memory ordering semantics;
2. why `Atomic*`, locks, or normal fields are insufficient;
3. concurrency tests;
4. Java baseline behavior.

---

## 12. Annotation Scanning Rules

Annotation scanning is allowed with strict boundaries.

Mandatory:

1. bounded package prefixes;
2. no full-classpath scan unless framework-owned and measured;
3. no loading arbitrary classes from untrusted jars;
4. startup time budget;
5. cache lifecycle;
6. deterministic ordering;
7. duplicate/ambiguous annotation handling;
8. test for missing/invalid annotation.

Forbidden:

```java
scan("/");
scan("com");
scan(System.getProperty("scan.packages")); // without validation
```

Required pattern:

```text
Annotation Scan Policy
- Root packages: com.company.product.module
- Included annotations: @UseCase, @Adapter
- Excluded packages: test fixtures, generated classes
- Duplicate behavior: fail startup
- Missing behavior: fail startup or ignore with metric
```

---

## 13. Dynamic Proxy Rules

Dynamic proxies are allowed for interface-based cross-cutting concerns.

Allowed:

1. metrics wrapper;
2. tracing wrapper;
3. transaction boundary wrapper;
4. retry wrapper with idempotency policy;
5. access control guard;
6. test doubles.

Forbidden:

1. hiding business logic in `InvocationHandler`;
2. swallowing target exceptions;
3. using proxy to mutate arguments unexpectedly;
4. logging secrets from arguments;
5. proxying arbitrary interfaces selected by user input;
6. creating multiple proxy layers without observability.

Rules:

1. Proxy must implement a known interface.
2. Handler must be small and deterministic.
3. Handler must preserve `equals`, `hashCode`, and `toString` semantics intentionally.
4. Handler must unwrap and map `InvocationTargetException`.
5. Tests must cover success, failure, exception propagation, and method metadata.

---

## 14. Records and Reflection

For Java 16+ records:

Allowed:

1. inspect record components;
2. read annotations on components;
3. call canonical constructor with validated values;
4. generate metadata/documentation.

Forbidden:

1. mutating record fields reflectively;
2. bypassing canonical constructor validation;
3. treating records as mutable JavaBeans;
4. assuming record component order can replace explicit schema versioning;
5. serializing records without explicit external contract.

---

## 15. Sealed Types and Reflection

For Java 17+ sealed classes/interfaces:

Allowed:

1. inspect permitted subclasses for metadata;
2. validate closed hierarchy at startup;
3. generate exhaustive mapping tests.

Forbidden:

1. dynamically creating subclasses outside the sealed hierarchy;
2. using reflection to bypass sealed type design;
3. assuming classpath scanning is enough to discover all legal subtypes;
4. using sealed hierarchy as external wire protocol without explicit type discriminator policy.

---

## 16. Reflection and Security

Reflection must be treated as security-sensitive.

### 16.1 Trust Boundary Rules

Untrusted input must never control:

1. class name;
2. package name;
3. method name;
4. field name;
5. constructor signature;
6. annotation name;
7. module open/export directive;
8. classpath location;
9. script/plugin jar;
10. deserialization target type.

### 16.2 Sensitive Data Rules

Reflective code must not dump object state indiscriminately.

Forbidden:

1. logging all fields of arbitrary objects;
2. serializing private fields by default;
3. reflecting through exception objects and request contexts;
4. exposing secrets, tokens, passwords, PII, session data, cryptographic material;
5. using reflection-based `toString` on domain/security objects.

### 16.3 Deserialization Boundary

Reflection is commonly used by serializers. Deserialization must be allow-list based.

Rules:

1. Do not deserialize into arbitrary types chosen by payload.
2. Do not enable global polymorphic deserialization without a strict subtype validator.
3. Do not deserialize into domain entities directly from untrusted JSON/XML.
4. Do not allow reflective construction of dangerous classes.
5. Validate DTO after deserialization.

---

## 17. Reflection and Performance

Reflection can be slower and harder for JIT/static analysis to optimize.

Rules:

1. Do not use reflection inside tight loops unless measured and approved.
2. Resolve metadata once, not per element.
3. Cache `Method`, `Constructor`, or `MethodHandle` safely.
4. Avoid reflective field-by-field mapping for high-volume pipelines unless generated code is impossible.
5. Add microbenchmark only when reflection is on a hot path.
6. Include allocation analysis for reflection-heavy mapper code.

Forbidden:

```java
for (Object item : items) {
    Field f = item.getClass().getDeclaredField("status");
    f.setAccessible(true);
    statuses.add((String) f.get(item));
}
```

Required alternative:

```java
for (Order item : items) {
    statuses.add(item.status());
}
```

---

## 18. Error Model

Reflective errors must be deterministic and actionable.

Rules:

1. Fail fast at startup for configuration/reflection contract errors.
2. Fail request/message only for data-specific invalid input.
3. Include target class/member in internal logs.
4. Do not include internal class/member details in public API response unless safe.
5. Preserve root cause.
6. Use dedicated exception types.

Example:

```java
public final class ReflectionContractException extends RuntimeException {
    public ReflectionContractException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

---

## 19. Testing Requirements

Reflective code requires tests beyond happy path.

Mandatory tests:

1. allowed type succeeds;
2. disallowed type fails;
3. missing method/field fails with clear error;
4. wrong signature fails;
5. private member access fails unless explicitly approved;
6. module encapsulation behavior under target JDK;
7. classloader/cache lifecycle if applicable;
8. invalid annotation metadata;
9. duplicate/ambiguous annotations;
10. performance smoke test for startup scan or hot path.

Security tests:

1. untrusted class name rejected;
2. untrusted method name rejected;
3. JDK internal access rejected;
4. secret fields not logged/serialized;
5. polymorphic deserialization allow-list enforced.

---

## 20. Code Review Checklist

A reviewer must reject reflective code if any answer is missing:

- [ ] Is reflection truly necessary?
- [ ] Is there a static alternative?
- [ ] Is Java baseline declared?
- [ ] Are allowed classes/packages/members explicit?
- [ ] Can untrusted input influence reflective target?
- [ ] Is `setAccessible(true)` absent or explicitly approved?
- [ ] Are JDK internals avoided?
- [ ] Are module boundaries respected?
- [ ] Are failures mapped clearly?
- [ ] Are target exceptions unwrapped correctly?
- [ ] Is metadata cached safely?
- [ ] Is classloader lifecycle considered?
- [ ] Are secrets excluded from reflective logging/serialization?
- [ ] Are tests included for negative cases?
- [ ] Is performance acceptable for scan/hot path?

---

## 21. LLM Code Agent Contract

When implementing reflection-related code, the agent must follow this contract:

```text
You are implementing Java reflection-sensitive code.
You must not use reflection unless necessary.
You must first propose a non-reflective alternative.
If reflection is necessary, provide a Reflection Design Note.
You must not use setAccessible(true) unless explicitly approved.
You must not access JDK internals.
You must not let user input choose class, method, field, constructor, package, module, or classpath.
You must use allow-lists for dynamic targets.
You must map ReflectiveOperationException into domain/application exceptions.
You must add negative tests for disallowed targets and missing members.
```

---

## 22. References

- Oracle Java `AccessibleObject` API: https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/reflect/AccessibleObject.html
- Oracle migration guide, strong encapsulation from JDK 17+: https://docs.oracle.com/en/java/javase/21/migrate/migrating-jdk-8-later-jdk-releases.html
- Oracle Java reflection package: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/reflect/package-summary.html
- Oracle Java `MethodHandle` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/invoke/MethodHandle.html
- Oracle Java `VarHandle` API: https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/invoke/VarHandle.html
- Oracle Java serialization filtering: https://docs.oracle.com/en/java/javase/21/core/java-serialization-filters.html
- OWASP Deserialization Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html
