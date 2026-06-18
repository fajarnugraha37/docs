# Part 20 — Java 8 to 25 Compatibility Engineering for OSGi Systems

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `20-java-8-to-25-compatibility-engineering-osgi-systems.md`  
> Scope: advanced OSGi compatibility engineering across Java 8, 9, 11, 17, 21, and 25  
> Goal: build the mental model and practical engineering discipline required to keep OSGi systems evolvable across long Java runtime generations.

---

## 0. Why This Part Matters

OSGi systems tend to live longer than ordinary Java applications.

A normal service can often be rebuilt, redeployed, or replaced as a unit. An OSGi system, especially one used as a platform, plugin host, enterprise container, RCP application, embedded gateway, or regulated runtime, usually carries a more difficult burden:

1. old bundles must keep running;
2. new bundles must be introduced without breaking old ones;
3. third-party libraries move at different speeds;
4. some bundles are owned by different teams or vendors;
5. the Java runtime underneath changes aggressively over time;
6. class loading, reflection, service discovery, and security assumptions are more fragile than in flat classpath applications.

Java 8 to Java 25 is not a simple version jump. It crosses multiple platform eras:

| Era | Java versions | Main compatibility pressure |
|---|---:|---|
| Classic enterprise Java era | Java 8 | Classpath-centric, Java EE APIs historically present or commonly assumed, weak encapsulation, Security Manager still available |
| Modular Java transition | Java 9–10 | JPMS introduced, JDK internals start being encapsulated, removed/changed tooling expectations |
| Long-term modernization baseline | Java 11 | Java EE/CORBA modules removed from JDK, many legacy libraries break unless dependencies are added explicitly |
| Strong encapsulation era | Java 16–17 | Illegal reflective access becomes much stricter; Java 17 deprecates Security Manager for removal through JEP 411 |
| Modern concurrency/runtime era | Java 21 | virtual threads become production-grade; structured concurrency/scoped values still evolving |
| Post-Security-Manager and latest LTS-style platform era | Java 24–25 | Security Manager is permanently disabled in JDK 24+, Java 25 continues modern platform evolution |

The OSGi-specific problem is not merely “does my code compile on Java 25?”

The deeper questions are:

- Does the framework advertise the right execution environment capabilities?
- Do bundles declare the correct runtime capability requirements?
- Does bytecode level match the oldest runtime that must load the bundle?
- Do generated manifests import packages that still exist on the target JDK?
- Did a library assume classpath/global class visibility that OSGi does not provide?
- Did a library use JDK internals that were tolerated on Java 8 but fail on Java 17+?
- Does a plugin security model still rely on Security Manager semantics that no longer exist?
- Can the same platform host Java 8-era bundles and Java 21/25-era bundles safely?
- Do javax and jakarta variants coexist intentionally, or accidentally?

This part gives you a compatibility engineering model. The objective is not memorizing every Java release note. The objective is to design OSGi systems whose compatibility can be reasoned about, tested, and governed.

---

## 1. Compatibility in OSGi Is Multi-Dimensional

In flat Java applications, compatibility is often reduced to three questions:

1. Does it compile?
2. Does it start?
3. Do tests pass?

In OSGi, that is insufficient. A bundle can compile but fail to resolve. It can resolve but fail to start. It can start but fail when a service appears. It can work on Felix but fail on Equinox due to launch or classloading assumptions. It can work on Java 8 but fail on Java 17 because reflection into JDK internals is now denied.

Think of compatibility as seven layers.

```text
Application behavior compatibility
        ↑
Service contract compatibility
        ↑
Package/API binary compatibility
        ↑
Bundle manifest/wiring compatibility
        ↑
Library/classloading compatibility
        ↑
JDK runtime compatibility
        ↑
Bytecode/toolchain compatibility
```

Each layer has a different failure mode.

| Layer | Example failure | Typical symptom |
|---|---|---|
| Bytecode/toolchain | Bundle compiled for Java 21 but runtime is Java 17 | `UnsupportedClassVersionError` |
| JDK runtime | Code uses removed Java EE module | `ClassNotFoundException: javax.xml.bind...` |
| Library/classloading | Library uses TCCL or reflection incorrectly | provider not found, scanner returns nothing |
| Manifest/wiring | Missing `Import-Package` or wrong version range | bundle remains `INSTALLED` |
| Package/API | Consumer expects method removed from exported package | `NoSuchMethodError` |
| Service contract | Service behavior changed without interface change | incorrect runtime behavior |
| Application behavior | migration changes threading/security semantics | subtle production failure |

A top-tier OSGi engineer treats each layer explicitly.

---

## 2. Java 8 to 25: What Actually Changes for OSGi Engineers

This section is not a generic Java release summary. It focuses on changes that materially affect OSGi systems.

### 2.1 Java 8: The Old Stable Baseline

Java 8 is still common in older OSGi platforms because many long-lived systems started there. The Java 8 environment has these characteristics:

- no JPMS;
- weak platform encapsulation;
- widespread reliance on classpath behavior;
- many libraries assume `ClassLoader.getSystemClassLoader()` or TCCL sees everything;
- Java EE APIs were commonly available through application servers or sometimes expected from the platform ecosystem;
- Security Manager still exists;
- many OSGi bundles use `Bundle-RequiredExecutionEnvironment: JavaSE-1.8` or older forms;
- many older ASM/CGLIB/ByteBuddy/Javassist versions were built around Java 8 bytecode assumptions.

Java 8-era OSGi systems often have hidden compatibility debt:

```text
works because Java 8 is permissive
works because classpath contains accidental APIs
works because reflection into JDK internals is allowed
works because old libraries assume one global classpath
works because Security Manager still exists
works because javax packages dominate
```

When migrating to Java 17/21/25, the problem is usually not Java syntax. The problem is implicit runtime assumptions.

### 2.2 Java 9: JPMS Introduces a New Reality

Java 9 introduced the Java Platform Module System. OSGi does not disappear, but the underlying JDK becomes modular.

Impacts:

- many JDK internals become encapsulated;
- access to internal packages becomes controlled;
- `--add-opens` and `--add-exports` become migration tools;
- old assumptions about boot classpath weaken;
- `rt.jar` disappears;
- class/resource discovery behavior changes for code that inspects JDK internals;
- some modules that existed in Java 9/10 as deprecated Java EE modules are removed later in Java 11.

OSGi bundles usually still run on the classpath/unnamed module side of the application, but the JDK they run on is no longer the same open world as Java 8.

### 2.3 Java 11: Removed Java EE and CORBA Modules

Java 11 is one of the largest compatibility cliffs for older enterprise Java/OSGi applications.

The practical issue:

- APIs like JAXB, JAX-WS, Java Activation, and CORBA are no longer bundled with the JDK.
- If old bundles import `javax.xml.bind`, `javax.activation`, or related packages, those packages must now be supplied explicitly as bundles or wrapped libraries.

In OSGi, this becomes a resolver problem:

```text
Bundle A imports javax.xml.bind
Java 8 runtime accidentally provides or environment includes it
Java 11 runtime does not
No bundle exports javax.xml.bind
Bundle A remains unresolved
```

A classpath application may fail at runtime. An OSGi application often fails earlier at resolve time, which is better, but only if imports are accurate.

### 2.4 Java 17: Stronger Encapsulation and Security Manager Deprecation

Java 17 is often the modernization target because many organizations standardized on it.

OSGi impact:

- illegal reflective access issues become more visible;
- frameworks/libraries that use deep reflection need explicit `--add-opens` or upgraded versions;
- old bytecode manipulation libraries may fail;
- Security Manager is deprecated for removal through JEP 411;
- platform teams must stop treating Security Manager as future-proof plugin isolation.

A common migration trap:

```text
The OSGi resolver says all bundles are fine.
Bundles start.
Then Hibernate, JAXB, CDI, proxy generation, JSON mapping, or an old scanner fails because it reflects into JDK internals.
```

This is not a resolver failure. It is a JDK encapsulation/runtime behavior failure.

### 2.5 Java 21: Virtual Threads Become Mainstream

Java 21 makes virtual threads generally available. This affects OSGi systems not because OSGi requires virtual threads, but because modern libraries and application code may start using them.

OSGi-specific concerns:

- lifecycle management of executors becomes more important;
- bundle stop must close virtual-thread executors;
- `ThreadLocal` assumptions become risky at larger concurrency scale;
- TCCL propagation must be deliberate;
- service invocation that blocks may become cheaper but not magically safe;
- JDBC drivers may benefit if blocking I/O is the bottleneck, but connection pools still limit throughput;
- DS activation should still not block heavily just because virtual threads exist.

Virtual threads reduce the cost of blocking. They do not remove the need for backpressure, lifecycle control, service contract discipline, or resource limits.

### 2.6 Java 24 and 25: Security Manager Permanently Disabled, Modern Runtime Baseline

For OSGi platforms that historically relied on `PermissionAdmin`, `ConditionalPermissionAdmin`, or Java policy files as part of plugin isolation, Java 24/25 changes the security story materially.

Security Manager was deprecated for removal in Java 17 by JEP 411. JDK 24 permanently disables it through JEP 486. Oracle's JDK 25 security guide also documents Security Manager as permanently disabled.

The design implication is simple and important:

> On Java 24/25, do not claim strong in-process sandboxing for arbitrary untrusted OSGi bundles based on Security Manager.

For Java 25-era systems, treat OSGi security as governance and runtime control, not as complete memory/process isolation.

Use:

- signed bundles;
- trusted repositories;
- admission testing;
- service boundary restrictions;
- process/container isolation for untrusted code;
- management endpoint hardening;
- audit logging;
- SBOM and vulnerability scanning;
- operational kill switch.

Do not use:

- “same JVM untrusted plugin sandbox” as a primary security boundary.

---

## 3. Execution Environment: The OSGi Compatibility Declaration

OSGi has a concept called Execution Environment. It represents the Java platform capabilities required by a bundle.

Historically, bundles used:

```text
Bundle-RequiredExecutionEnvironment: JavaSE-1.8
```

In modern OSGi, the capability model is preferred:

```text
Require-Capability: osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=17))"
```

The important distinction:

- `Bundle-RequiredExecutionEnvironment` is the older/deprecated style in Core R8.
- `Require-Capability: osgi.ee` is the newer capability/requirement model.

### 3.1 What Execution Environment Solves

Execution environment answers:

> What minimum Java platform must this bundle run on?

Examples:

```text
Require-Capability: osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=1.8))"
```

```text
Require-Capability: osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=11))"
```

```text
Require-Capability: osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=17))"
```

```text
Require-Capability: osgi.ee;filter:="(&(osgi.ee=JavaSE)(version=21))"
```

If the framework is running on Java 17, it should advertise JavaSE 17 capability and usually lower compatible JavaSE capabilities too, depending on framework and launcher metadata.

### 3.2 Execution Environment Is Not the Same as Bytecode Level

This is a common mistake.

Bytecode level says:

```text
Can the JVM load this .class file?
```

Execution environment says:

```text
Does the runtime provide the Java platform API level this bundle requires?
```

Example:

| Bundle compiled target | EE requirement | Runtime | Result |
|---:|---:|---:|---|
| Java 8 bytecode | JavaSE-1.8 | Java 17 | likely OK |
| Java 17 bytecode | JavaSE-17 | Java 11 | class load failure / resolver failure |
| Java 8 bytecode | JavaSE-17 | Java 11 | bytecode load OK, but API requirement not satisfied |
| Java 11 bytecode | JavaSE-1.8 | Java 8 | impossible at class load time |

A correct build must align both.

### 3.3 Recommended Rule

For each bundle, declare the lowest environment that is true.

Do not lazily declare JavaSE-17 just because the build machine uses Java 17. Declare JavaSE-17 only if the bundle actually uses Java 17 APIs or bytecode.

Bad:

```text
All bundles built on JDK 17 automatically require JavaSE-17.
```

Better:

```text
API bundles remain JavaSE-1.8 when possible.
Implementation bundles use JavaSE-11/17/21 only when they need those APIs.
Runtime distribution has a tested matrix.
```

This lets a platform host older extension APIs while modernizing internal implementation bundles.

---

## 4. Bytecode and Toolchain Matrix

Java class files have major versions. A JVM cannot load class files compiled for a newer Java version than itself.

Approximate key class file versions:

| Java | Class file major version |
|---:|---:|
| 8 | 52 |
| 9 | 53 |
| 11 | 55 |
| 17 | 61 |
| 21 | 65 |
| 25 | 69 |

A Java 17 runtime cannot load Java 21 class files. An OSGi resolver might not catch this if metadata is wrong; the failure appears when classes are loaded.

### 4.1 Use `--release`, Not Just `sourceCompatibility` / `targetCompatibility`

In modern Java builds, prefer `--release` for cross-compilation.

Why?

`sourceCompatibility = 8` and `targetCompatibility = 8` can still accidentally compile against newer JDK APIs if not configured correctly. `--release 8` restricts the visible platform API to Java 8.

Gradle example:

```groovy
java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

tasks.withType(JavaCompile).configureEach {
    options.release = 8
}
```

This means:

- use JDK 25 compiler;
- emit Java 8-compatible bytecode;
- prevent accidental Java 11/17/21/25 API usage.

Maven example:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <version>3.13.0</version>
  <configuration>
    <release>8</release>
  </configuration>
</plugin>
```

### 4.2 Bundle Categories by Java Baseline

A large OSGi system should not use one baseline blindly. Categorize bundles.

| Bundle type | Recommended baseline strategy |
|---|---|
| Public API bundles | Keep as low as feasible, often Java 8 or 11 |
| SPI/plugin API bundles | Keep low if third-party plugins need broad compatibility |
| Internal implementation bundles | Can move faster, e.g. 17/21/25 |
| Runtime integration bundles | Match runtime JDK and library needs |
| Test bundles | Can use newer Java if not shipped |
| Tooling/generator bundles | Can use newer Java if not deployed to target runtime |

This is especially useful when modernizing from Java 8 to Java 17/21/25.

The compatibility architecture might look like this:

```text
+----------------------------------------------------+
| Runtime distribution on Java 21 or 25              |
|                                                    |
|  API bundles                Java 8/11 bytecode     |
|  Plugin SPI bundles         Java 8/11 bytecode     |
|  Domain implementation      Java 17 bytecode       |
|  Infrastructure bundles     Java 17/21 bytecode    |
|  Modern async bundles       Java 21 bytecode       |
|                                                    |
+----------------------------------------------------+
```

This avoids forcing every plugin author to move at the same pace as the platform implementation.

---

## 5. Package Imports Across Java Versions

OSGi resolves packages, not Maven artifacts. Java version compatibility often manifests as package availability compatibility.

### 5.1 System Packages

The OSGi framework exports some packages from the parent/system class loader as system packages. These packages become visible to bundles if they import them.

Examples might include Java standard packages such as:

```text
java.sql
javax.crypto
javax.net.ssl
javax.xml.parsers
org.w3c.dom
org.xml.sax
```

The exact list depends on framework configuration and Java runtime.

### 5.2 Removed Packages and APIs

Java 11 removed several Java EE/CORBA modules from the JDK. In OSGi terms, imports that accidentally resolved before may no longer resolve.

Common problematic packages:

```text
javax.xml.bind
javax.xml.ws
javax.jws
javax.activation
javax.annotation
javax.transaction
org.omg.*
```

Some of these were never guaranteed in Java SE in the same way application developers assumed. The key point is operational: do not rely on the JDK to provide enterprise APIs.

Instead, supply them intentionally.

Example:

```text
Bundle A imports javax.xml.bind
Bundle B exports javax.xml.bind;version="2.3.0"
```

or migrate to Jakarta variants when appropriate:

```text
jakarta.xml.bind
jakarta.activation
jakarta.annotation
jakarta.transaction
```

### 5.3 Do Not Mix javax and jakarta Accidentally

The `javax` to `jakarta` namespace change is a hard package-name compatibility break.

For OSGi, this is especially explicit:

```text
Import-Package: javax.servlet;version="[3.1,5)"
```

is not compatible with:

```text
Import-Package: jakarta.servlet;version="[5,7)"
```

These are different packages. The resolver will not magically bridge them.

You need an architecture decision:

| Strategy | Meaning | Risk |
|---|---|---|
| Stay javax | Keep legacy APIs | older ecosystem, harder future migration |
| Move jakarta | Modern APIs | breaks legacy bundles |
| Dual runtime island | Host both in isolated subsystems | complexity, avoid type crossing |
| Adapter boundary | Convert at explicit boundary | extra code, safest for migration |

### 5.4 javax/jakarta Boundary Rule

Never expose both variants through the same public service contract unless you are deliberately designing a bridge.

Bad:

```java
public interface WebPlugin {
    void register(javax.servlet.Servlet servlet);
    void register(jakarta.servlet.Servlet servlet);
}
```

Better:

```java
public interface HttpEndpointPlugin {
    EndpointDescriptor describeEndpoint();
    EndpointHandler createHandler();
}
```

Then the host maps the abstraction to either javax or jakarta runtime internally.

---

## 6. Strong Encapsulation and Reflective Access

Java 8 allowed many reflective hacks. Java 17+ is less forgiving.

OSGi makes this more interesting because there are two layers of encapsulation:

1. OSGi package visibility.
2. JPMS/JDK strong encapsulation.

A class may be visible from OSGi perspective but still fail reflective access due to JPMS encapsulation.

### 6.1 Typical Failures

Examples:

```text
java.lang.reflect.InaccessibleObjectException
Unable to make field private final ... accessible
module java.base does not "opens java.lang" to unnamed module
```

or:

```text
IllegalAccessError
```

or framework/library-specific failures in:

- Hibernate;
- Jackson;
- JAXB;
- XStream;
- Kryo;
- CGLIB;
- ByteBuddy;
- Mockito;
- old Spring;
- old CDI implementations;
- old annotation scanners;
- old XML libraries;
- scripting engines;
- serialization frameworks.

### 6.2 Migration Tools: `--add-opens` and `--add-exports`

`--add-opens` allows deep reflection into a package.

Example:

```bash
--add-opens java.base/java.lang=ALL-UNNAMED
```

`--add-exports` exports a package at compile/runtime access level.

Example:

```bash
--add-exports java.base/sun.nio.ch=ALL-UNNAMED
```

In many OSGi systems, bundles are loaded as classes in the unnamed module from the JPMS perspective, so `ALL-UNNAMED` is common.

But these flags should be treated as migration debt, not permanent architecture.

### 6.3 Decision Rule

Use this order:

1. upgrade the problematic library;
2. configure the library to avoid illegal reflection;
3. isolate the legacy library in a compatibility bundle;
4. use `--add-opens` as temporary runtime compatibility;
5. document every `--add-opens` with owner, reason, removal target.

Example runtime flag registry:

| Flag | Needed by | Reason | Removal condition |
|---|---|---|---|
| `--add-opens java.base/java.lang=ALL-UNNAMED` | legacy proxy lib | old reflection | remove after ByteBuddy upgrade |
| `--add-opens java.base/java.util=ALL-UNNAMED` | old serializer | field access | replace serializer |

Do not let launch scripts accumulate undocumented flags.

---

## 7. Multi-Release JARs and OSGi Bundles

Multi-release JARs allow different class versions for different Java runtimes:

```text
/META-INF/versions/9/...
/META-INF/versions/11/...
/META-INF/versions/17/...
```

This can be useful for libraries that want to provide Java 8 baseline plus optimized implementations for later Java versions.

### 7.1 Why MR-JARs Are Tricky in OSGi

OSGi analyzes bundle metadata and package imports. If build tooling does not understand MR-JARs correctly, the generated manifest may miss imports used only in version-specific classes.

Potential failure:

```text
Java 8 class path imports package A
Java 17 versioned class imports package B
Manifest only declares package A
On Java 17, class loads and needs package B
No import for B
Runtime failure
```

### 7.2 Guidelines

Use MR-JARs sparingly for OSGi bundles.

Good use cases:

- small compatibility shims;
- optimized implementation class selected by runtime;
- JDK-specific integration hidden behind stable API.

Bad use cases:

- entire application behavior changes per JDK;
- public API differs per JDK;
- package exports differ per JDK;
- service contracts differ per JDK.

### 7.3 Better Alternative for Platforms

In a platform, separate JDK-specific implementation bundles are often easier to reason about.

```text
com.acme.crypto.api                 Java 8 API bundle
com.acme.crypto.impl.java8           Java 8 implementation
com.acme.crypto.impl.java17          Java 17 implementation
com.acme.crypto.impl.java25          Java 25 implementation
```

Then use OSGi capabilities or service ranking to select the implementation.

Example:

```text
Provide-Capability: com.acme.crypto.impl;java="17"
Require-Capability: osgi.ee;filter:="(&(osgi.ee=JavaSE)(version>=17))"
```

This keeps runtime selection explicit.

---

## 8. Virtual Threads in OSGi Systems

Virtual threads are a JVM feature, not an OSGi feature. But they affect OSGi service design.

### 8.1 What Virtual Threads Change

Virtual threads make blocking cheaper. They are useful for workloads with many concurrent blocking operations, such as:

- HTTP calls;
- JDBC calls;
- file I/O;
- external API calls;
- waiting on queues;
- many independent short-lived tasks.

They do not make CPU work faster. They do not remove database connection pool limits. They do not remove external API rate limits.

### 8.2 OSGi-Specific Lifecycle Concern

If a bundle creates an executor, the bundle must close it when stopped.

Bad:

```java
@Component
public class Worker {
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    public void submit(Runnable task) {
        executor.submit(task);
    }
}
```

This has no shutdown path.

Better:

```java
@Component(service = Worker.class)
public class Worker {
    private ExecutorService executor;

    @Activate
    void activate() {
        executor = Executors.newVirtualThreadPerTaskExecutor();
    }

    @Deactivate
    void deactivate() {
        executor.close();
    }

    public Future<?> submit(Runnable task) {
        return executor.submit(task);
    }
}
```

But even this is incomplete if tasks use OSGi services that can disappear while tasks are running.

### 8.3 Service Snapshot Pattern with Async Work

When async work uses dynamic services, take a deliberate snapshot.

```java
@Component(service = ValidationExecutor.class)
public class ValidationExecutor {
    private final List<ValidationRule> rules = new CopyOnWriteArrayList<>();
    private ExecutorService executor;

    @Activate
    void activate() {
        executor = Executors.newVirtualThreadPerTaskExecutor();
    }

    @Deactivate
    void deactivate() {
        executor.close();
    }

    @Reference(
        service = ValidationRule.class,
        cardinality = ReferenceCardinality.MULTIPLE,
        policy = ReferencePolicy.DYNAMIC
    )
    void bindRule(ValidationRule rule) {
        rules.add(rule);
    }

    void unbindRule(ValidationRule rule) {
        rules.remove(rule);
    }

    public Future<ValidationResult> validate(CaseData data) {
        List<ValidationRule> snapshot = List.copyOf(rules);
        return executor.submit(() -> runRules(snapshot, data));
    }
}
```

This avoids iterating over a list being changed underneath you.

### 8.4 TCCL and Virtual Threads

Some libraries use Thread Context ClassLoader. Virtual threads inherit context at creation time like ordinary threads, but high-volume task creation can amplify classloader leak risks.

Avoid setting TCCL globally and forgetting to restore it.

Correct pattern:

```java
ClassLoader previous = Thread.currentThread().getContextClassLoader();
try {
    Thread.currentThread().setContextClassLoader(targetClassLoader);
    action.run();
} finally {
    Thread.currentThread().setContextClassLoader(previous);
}
```

In OSGi, a leaked TCCL can pin a bundle classloader after bundle update/uninstall.

### 8.5 Virtual Threads Do Not Replace Backpressure

Bad mental model:

```text
Virtual threads are cheap, so we can spawn unlimited work.
```

Correct mental model:

```text
Virtual threads are cheap carriers for blocking tasks, but external resources remain finite.
```

Still limit:

- DB connections;
- API calls;
- queue consumption;
- memory usage;
- CPU-heavy work;
- service degradation paths.

---

## 9. Security Manager Removal and OSGi Plugin Security

This is important enough to repeat in engineering terms.

### 9.1 Old Model

Some historical OSGi platforms imagined this security shape:

```text
Untrusted bundle
   ↓
OSGi permission checks
   ↓
Java Security Manager
   ↓
Same JVM sandbox
```

On modern Java, especially Java 24/25, this is no longer a defensible primary model.

### 9.2 New Model

Use this instead:

```text
Plugin admission governance
   ↓
Signed bundle and repository trust
   ↓
API/SPI compatibility tests
   ↓
Runtime service boundary
   ↓
Operational monitoring and kill switch
   ↓
Process/container isolation for untrusted code
```

### 9.3 Plugin Trust Levels

Define plugin trust explicitly.

| Trust level | Allowed hosting model |
|---|---|
| Platform-owned trusted bundle | same OSGi framework |
| Partner-certified plugin | same framework only after certification/signing |
| Customer extension with source review | maybe same framework, restricted APIs |
| Arbitrary third-party code | separate process/container, not same JVM |
| User-submitted code | remote sandbox/process, never same JVM as core platform |

### 9.4 Security Compatibility Checklist

Before Java 24/25 migration, search for:

```text
SecurityManager
System.setSecurityManager
AccessController.doPrivileged
java.security.Policy
PermissionAdmin
ConditionalPermissionAdmin
policy file launch args
-Djava.security.manager
```

Then classify:

- dead code;
- test-only code;
- old sandbox assumption;
- still required by old library;
- OSGi permission model usage;
- replacement needed.

---

## 10. Library Compatibility: The Hidden Center of the Migration

Most Java 8 to 25 OSGi migrations fail because of libraries, not because of your own source code.

### 10.1 High-Risk Library Categories

| Category | Why risky in OSGi + modern Java |
|---|---|
| Bytecode libraries | must support newer class file versions |
| Reflection-heavy frameworks | hit JPMS encapsulation |
| Annotation scanners | classloader and module assumptions |
| Serialization frameworks | deep reflection, private field access |
| JDBC drivers | service discovery and Java version support |
| Logging bridges | multiple bindings/classloader scope |
| XML/JAXB libs | Java EE module removal, javax/jakarta split |
| Servlet/JAX-RS libs | javax/jakarta split |
| DI containers | lifecycle conflict with DS/Blueprint |
| Scripting engines | Nashorn removal, classloader assumptions |
| Test libraries | Mockito/ByteBuddy/ASM version support |

### 10.2 ASM/ByteBuddy/Javassist Rule

Every new Java class file version requires bytecode libraries to understand it.

If you run Java 25 or compile Java 25 bytecode, old bytecode tooling may fail while scanning classes.

Typical failure:

```text
Unsupported class file major version 69
```

This can occur in:

- annotation scanning;
- proxy generation;
- test mocking;
- persistence enhancement;
- OSGi manifest analysis;
- build-time plugins.

Rule:

> Upgrade bytecode-processing libraries before or alongside the Java runtime upgrade.

### 10.3 OSGi Wrapping Strategy for Non-OSGi Libraries

Many libraries are not proper OSGi bundles. You may need to wrap them.

Wrapper goals:

- export only stable API packages;
- keep implementation packages private;
- import dependencies explicitly;
- avoid embedding duplicate copies unless intentional;
- assign package versions;
- test resolver graph.

Example bnd wrapper idea:

```properties
Bundle-SymbolicName: com.acme.wrap.jackson.databind
Bundle-Version: 2.17.2
Export-Package: com.fasterxml.jackson.databind;version="2.17.2"
Private-Package: \
  com.fasterxml.jackson.databind.*
Import-Package: *
```

But be careful: exporting too broadly can expose internals and create uses-constraint issues.

---

## 11. javax to jakarta Compatibility Engineering

The javax→jakarta migration is not a normal version upgrade. It is a namespace fork.

### 11.1 Why OSGi Makes This Explicit

In OSGi, packages are identity. Therefore:

```text
javax.persistence.Entity
```

and:

```text
jakarta.persistence.Entity
```

are unrelated types.

Even if concepts are similar, the JVM type system treats them as different.

### 11.2 Common Split Areas

| Old namespace | New namespace |
|---|---|
| `javax.servlet` | `jakarta.servlet` |
| `javax.ws.rs` | `jakarta.ws.rs` |
| `javax.persistence` | `jakarta.persistence` |
| `javax.transaction` | `jakarta.transaction` |
| `javax.validation` | `jakarta.validation` |
| `javax.annotation` | `jakarta.annotation` |
| `javax.xml.bind` | `jakarta.xml.bind` |
| `javax.activation` | `jakarta.activation` |
| `javax.mail` | `jakarta.mail` |

### 11.3 Four Migration Patterns

#### Pattern 1: Big Bang Namespace Migration

All bundles move from javax to jakarta at once.

Pros:

- clean future state;
- less bridge complexity;
- one API family.

Cons:

- high risk;
- all plugins must migrate;
- old bundles break;
- large testing scope.

Best for smaller systems or systems with centralized ownership.

#### Pattern 2: Runtime Island

Keep javax subsystem and jakarta subsystem separate.

```text
javax web runtime island
  - legacy bundles
  - javax servlet/JAX-RS

jakarta web runtime island
  - new bundles
  - jakarta servlet/JAX-RS
```

Pros:

- gradual migration;
- old plugins survive.

Cons:

- operational complexity;
- boundary discipline required;
- duplicate frameworks possible.

#### Pattern 3: Adapter Boundary

Use internal neutral contracts and convert at boundary.

```java
public interface CaseEndpoint {
    HttpResponse handle(HttpRequest request);
}
```

Then provide:

```text
javax adapter bundle
jakarta adapter bundle
```

Pros:

- clean domain API;
- migration hidden from plugins;
- good for long-lived platform APIs.

Cons:

- adapter work;
- cannot expose servlet/JAX-RS types directly.

#### Pattern 4: Stay javax for Platform API, Use jakarta Internally Later

This can be valid if third-party plugin compatibility matters more than modern framework adoption.

But document it as a conscious compatibility decision, not neglect.

### 11.4 Rule for Public APIs

If you want a plugin API to survive Java 8→25, avoid exposing javax/jakarta framework types directly unless that API is specifically for that framework.

Bad plugin API:

```java
void contribute(javax.ws.rs.core.Application app);
```

Better plugin API:

```java
List<RouteDefinition> routes();
```

Framework-specific adapters translate later.

---

## 12. OSGi Framework Compatibility: Felix, Equinox, Karaf

Java runtime compatibility also depends on the OSGi framework and container version.

### 12.1 Framework Must Support Target JDK

Before upgrading runtime Java, verify:

- Felix Framework version supports that JDK;
- Equinox version supports that JDK;
- Karaf version supports that JDK;
- embedded Jetty/Pax Web supports that JDK;
- SCR implementation supports DS annotation/component versions;
- bnd version supports bytecode level;
- build plugins support bytecode level;
- test framework supports bytecode level.

A common mistake:

```text
Application code supports Java 21.
But bnd/ASM version in build cannot analyze Java 21 class files.
```

or:

```text
Framework starts on Java 17.
But embedded web container uses unsupported reflection.
```

### 12.2 Karaf Distribution Compatibility

Karaf adds another layer:

- Karaf version;
- underlying OSGi framework version;
- feature repository versions;
- Pax Web version;
- Aries Blueprint/Transaction/JPA versions;
- logging stack;
- shell dependencies;
- wrapper/service scripts.

For Java 17/21/25 upgrades, validate the whole distribution, not just your bundle.

### 12.3 Framework Upgrade First or Java Upgrade First?

Usually safer order:

1. upgrade build tooling on old Java;
2. upgrade OSGi framework/container while still on old Java if supported;
3. fix resolver/dependency issues;
4. upgrade third-party libraries;
5. run on intermediate Java, often 11 or 17;
6. fix reflective access and removed modules;
7. upgrade to target Java 21/25;
8. remove temporary flags.

Avoid jumping directly from old Felix/Equinox/Karaf on Java 8 to Java 25.

---

## 13. Compatibility Testing Matrix

A serious OSGi platform needs compatibility tests at multiple levels.

### 13.1 Minimal Test Matrix

For Java 8→25 engineering, use a matrix like:

| Test type | Java 8 | Java 11 | Java 17 | Java 21 | Java 25 |
|---|---:|---:|---:|---:|---:|
| API bundle compile | yes | yes | yes | yes | yes |
| API baseline check | yes | yes | yes | yes | yes |
| Resolver test | yes | yes | yes | yes | yes |
| Framework boot | maybe | yes | yes | yes | yes |
| DS activation test | maybe | yes | yes | yes | yes |
| Integration tests | maybe | yes | yes | yes | yes |
| Reflection/access smoke tests | no | yes | yes | yes | yes |
| Security model tests | yes | yes | yes | changed | changed |

You may not support all Java versions in production. But during migration, testing intermediate versions reveals which compatibility cliff you hit.

### 13.2 Test Axes

Do not test only Java version. Test combinations:

```text
JDK version
OSGi framework version
container/distribution version
bundle set version
feature repository version
javax/jakarta mode
database driver version
web runtime version
bytecode baseline
```

### 13.3 Resolver Tests

Resolver tests catch missing package providers before runtime.

Example questions:

- Can all required bundles resolve on Java 11?
- Can all required bundles resolve on Java 17?
- Which bundles import packages removed from JDK 11?
- Which bundles require JavaSE-21 but are included in Java 17 distribution?
- Which bundles import both javax and jakarta variants?

### 13.4 Runtime Smoke Tests

Resolver success is not enough.

Smoke tests should verify:

- framework starts;
- DS components are satisfied;
- Config Admin applies config;
- HTTP endpoints register;
- persistence service opens connection;
- transaction service works;
- event handlers receive events;
- classpath/resource scanning works;
- serialization/mapping works;
- proxy generation works;
- bundle update/refresh works;
- shutdown releases classloaders.

---

## 14. Migration Playbook: Java 8 OSGi to Java 17/21/25

This is the practical roadmap.

### 14.1 Phase 1 — Inventory

Collect:

```text
bundle symbolic name
bundle version
exported packages
imported packages
required capabilities
execution environment
bytecode level
embedded dependencies
third-party library versions
uses of reflection
uses of JDK internal APIs
uses of javax APIs
uses of SecurityManager
uses of TCCL
uses of ServiceLoader
uses of native code
```

Useful commands/tools:

- bnd print/analyze;
- `jdeps`;
- framework shell bundle headers;
- Karaf `bundle:*` commands;
- Equinox console;
- Felix Web Console;
- custom manifest scanner;
- dependency vulnerability scanner;
- SBOM tooling.

### 14.2 Phase 2 — Classify Bundles

Classify each bundle:

| Category | Meaning |
|---|---|
| API bundle | must remain stable and low baseline if possible |
| implementation bundle | can be modernized faster |
| third-party wrapper | may need library upgrade/re-wrapping |
| framework integration | high risk, classloader-sensitive |
| plugin bundle | external compatibility concern |
| deprecated bundle | candidate for removal |

### 14.3 Phase 3 — Fix Build and Metadata

Before runtime upgrade:

- upgrade bnd;
- upgrade Maven/Gradle plugins;
- use Java toolchains;
- set `--release` explicitly;
- generate manifests consistently;
- enable baseline checks;
- remove manual stale imports;
- replace `Bundle-RequiredExecutionEnvironment` with `osgi.ee` capability where appropriate;
- create resolver tests.

### 14.4 Phase 4 — Remove Java 8 Accidental Dependencies

Search for imports:

```text
javax.xml.bind
javax.activation
javax.xml.ws
javax.jws
javax.annotation
javax.transaction
org.omg
com.sun.*
sun.*
jdk.internal.*
```

For each:

- add explicit dependency bundle;
- replace with supported API;
- migrate to jakarta;
- isolate in compatibility bundle;
- delete if unused.

### 14.5 Phase 5 — Upgrade Framework and Libraries

Upgrade in controlled groups:

1. OSGi framework/container;
2. DS/SCR runtime;
3. Config Admin / Event Admin / HTTP runtime;
4. bytecode libraries;
5. persistence/web/messaging libraries;
6. testing libraries;
7. domain dependencies.

After each group, run resolver and smoke tests.

### 14.6 Phase 6 — Run on Java 11

Java 11 exposes removed module problems.

Fix:

- missing Java EE APIs;
- old TLS/security provider issues;
- old XML/JAXB issues;
- old logging issues;
- build/runtime scripts assuming `rt.jar`.

### 14.7 Phase 7 — Run on Java 17

Java 17 exposes strong encapsulation and Security Manager deprecation.

Fix:

- illegal reflection;
- old bytecode library support;
- `--add-opens` temporary flags;
- Security Manager assumptions;
- old test framework failures.

### 14.8 Phase 8 — Run on Java 21/25

Java 21/25 exposes newest class file/tooling/security assumptions.

Fix:

- bnd/ASM support for class file 65/69;
- test/mocking bytecode support;
- virtual-thread lifecycle if adopted;
- Security Manager permanently disabled by Java 24+;
- updated launch scripts;
- container image base;
- monitoring/JFR changes;
- TLS/cert defaults if applicable.

### 14.9 Phase 9 — Remove Migration Debt

Remove:

- unnecessary `--add-opens`;
- duplicate javax/jakarta bundles;
- unused compatibility wrappers;
- old package exports;
- overly wide version ranges;
- DynamicImport hacks;
- old start-level workarounds;
- temporary embedded dependencies.

---

## 15. Compatibility Design Patterns

### 15.1 Low-Baseline API, Modern Implementation

Keep public API old-compatible, implementation modern.

```text
case-api bundle              Java 8 or 11
case-spi bundle              Java 8 or 11
case-impl bundle             Java 17 or 21
case-observability bundle    Java 21
```

This lets old plugins continue implementing SPI while host internals modernize.

### 15.2 Compatibility Facade Bundle

Create a facade that hides Java version differences.

```java
public interface RuntimeClock {
    Instant now();
}

public interface ConcurrentTaskRunner {
    <T> Future<T> submit(Callable<T> task);
}
```

Then provide Java-specific implementation bundles.

### 15.3 Namespace Adapter Bundle

Bridge javax/jakarta at a narrow boundary.

```text
legacy-validation-api       exports javax.validation-facing API
modern-validation-adapter   converts to jakarta.validation internally
```

Use only when necessary. Do not make the whole platform dual-stack by accident.

### 15.4 Capability-Gated Implementation

Only install/start implementation if runtime capability exists.

```text
Require-Capability: osgi.ee;filter:="(&(osgi.ee=JavaSE)(version>=21))"
```

This prevents Java 21-specific bundles from resolving on Java 17.

### 15.5 Service Ranking for Runtime-Specific Implementations

Register multiple implementations and let runtime choose.

```text
Java8 implementation: service.ranking=10
Java17 implementation: service.ranking=20
Java21 implementation: service.ranking=30
```

But ensure only compatible implementations resolve on each runtime.

---

## 16. Anti-Patterns

### 16.1 “Compile Everything with the Latest Java”

This breaks plugin compatibility unnecessarily.

Better:

- API bundles low baseline;
- implementation bundles modern baseline;
- clear toolchain policy.

### 16.2 “The Runtime Is Java 25, So Every Bundle Requires JavaSE-25”

This destroys portability and makes old plugin compatibility impossible.

Execution environment should describe actual need, not build environment.

### 16.3 “Use DynamicImport to Survive Migration”

`DynamicImport-Package: *` may hide resolver problems until runtime.

It converts deterministic deployment failure into nondeterministic runtime failure.

### 16.4 “Just Add --add-opens Until It Works”

This may get production running, but it creates invisible upgrade debt.

Every `--add-opens` must have:

- owner;
- reason;
- related library;
- removal plan.

### 16.5 “Same JVM Plugin Sandbox Is Still Fine”

On Java 24/25, Security Manager is not a viable primary isolation mechanism.

Use process/container isolation for untrusted code.

### 16.6 “javax and jakarta Can Coexist Without Architecture”

They can coexist physically, but not safely without clear boundaries.

Accidental coexistence causes:

- duplicate APIs;
- type mismatch;
- service contract fragmentation;
- web runtime confusion;
- persistence provider mismatch.

### 16.7 “Resolver Success Means Compatibility Success”

Resolver success only proves package/capability constraints are satisfied.

It does not prove:

- reflection works;
- bytecode tools support the class version;
- service behavior is compatible;
- Security Manager assumptions hold;
- async lifecycle is safe;
- business behavior is correct.

---

## 17. Troubleshooting Playbook

### 17.1 `UnsupportedClassVersionError`

Meaning:

```text
Class file was compiled for newer Java than runtime can load.
```

Check:

- class file major version;
- build `--release`;
- bundle EE requirement;
- runtime JDK;
- toolchain config;
- embedded dependencies.

Fix:

- lower `--release`;
- run on newer JDK;
- exclude incompatible bundle;
- split Java-specific implementation.

### 17.2 Bundle Unresolved on New JDK

Check imports:

```text
javax.xml.bind
javax.activation
javax.annotation
javax.transaction
org.omg
```

Likely cause:

- package was previously available accidentally;
- Java 11+ no longer provides it;
- provider bundle missing.

Fix:

- add explicit API/implementation bundle;
- migrate namespace;
- correct import range.

### 17.3 `InaccessibleObjectException`

Likely cause:

- strong encapsulation;
- old reflection-heavy library.

Fix order:

1. upgrade library;
2. configure supported reflection mode;
3. add temporary `--add-opens`;
4. document and remove later.

### 17.4 `Unsupported class file major version 65/69` in Build or Startup

Likely cause:

- old ASM/bnd/ByteBuddy/scanner cannot parse Java 21/25 bytecode.

Fix:

- upgrade bnd;
- upgrade ASM/ByteBuddy/Javassist;
- upgrade Maven/Gradle plugins;
- ensure test tooling supports target Java.

### 17.5 Service Works on Java 8 but Fails on Java 17

Investigate:

- reflection into JDK internals;
- missing Java EE packages;
- TCCL assumptions;
- resource loading;
- service provider discovery;
- serialization/proxy generation.

Do not assume OSGi resolver is wrong. The issue may be runtime behavior.

### 17.6 Memory Leak After Bundle Refresh on Java 21/25

Investigate:

- virtual thread executor not closed;
- scheduled executor not stopped;
- TCCL pinning bundle classloader;
- static caches;
- service trackers not closed;
- logging appenders holding bundle classes;
- JMX registrations not unregistered;
- JDBC drivers not deregistered.

---

## 18. Production Upgrade Checklist

Use this before upgrading an OSGi runtime from Java 8/11/17 to Java 21/25.

### 18.1 Build and Metadata

- [ ] bnd version supports target class file level.
- [ ] Maven/Gradle plugins support target Java.
- [ ] Java toolchains configured.
- [ ] `--release` set intentionally per bundle category.
- [ ] API bundles kept at lowest feasible baseline.
- [ ] `Require-Capability: osgi.ee` generated/declared correctly.
- [ ] `Bundle-RequiredExecutionEnvironment` not relied upon as primary modern metadata.
- [ ] Baseline checks enabled.
- [ ] Resolver tests exist for target runtime.

### 18.2 Dependencies

- [ ] bytecode libraries upgraded.
- [ ] logging stack checked.
- [ ] JDBC drivers support target Java.
- [ ] web runtime supports target Java.
- [ ] persistence provider supports target Java.
- [ ] JSON/XML libraries support target Java.
- [ ] test/mocking libraries support target Java.
- [ ] non-OSGi libraries wrapped intentionally.

### 18.3 Java EE / Jakarta

- [ ] removed Java EE APIs identified.
- [ ] `javax.*` imports reviewed.
- [ ] `jakarta.*` imports reviewed.
- [ ] no accidental mixed public API.
- [ ] adapter strategy documented if dual-stack exists.

### 18.4 Encapsulation

- [ ] `jdeps` run for internal JDK API use.
- [ ] illegal reflection smoke tests run.
- [ ] all `--add-opens` documented.
- [ ] all `--add-exports` documented.
- [ ] removal plan exists for runtime flags.

### 18.5 Security

- [ ] Security Manager usage inventoried.
- [ ] Java 24/25 permanent disablement considered.
- [ ] plugin trust model updated.
- [ ] untrusted code moved out-of-process.
- [ ] management shell secured.
- [ ] signed bundle/repository policy reviewed.

### 18.6 Runtime

- [ ] framework/container supports target Java.
- [ ] DS components all satisfied.
- [ ] Config Admin works.
- [ ] Event Admin works.
- [ ] HTTP endpoints work.
- [ ] persistence works.
- [ ] startup/shutdown tested.
- [ ] bundle update/refresh tested.
- [ ] classloader leak tests executed.
- [ ] observability works.

### 18.7 Operations

- [ ] launch scripts updated.
- [ ] Docker base image updated.
- [ ] memory and GC settings reviewed.
- [ ] JFR/monitoring agents support target Java.
- [ ] TLS/cert compatibility checked.
- [ ] rollback image available.
- [ ] canary runtime tested.

---

## 19. Case Study: Regulated Enforcement Platform Migrating from Java 8 to 21/25

Assume a platform with dynamic enforcement rule plugins.

### 19.1 Current State

```text
Java 8
Apache Felix/Karaf old version
javax servlet/JAX-RS
JPA provider old version
rule plugin API exposes javax.validation
some plugins use JAXB
some connectors use old HTTP clients
some bundles use BundleActivator
some services use thread pools without lifecycle cleanup
plugin security assumes Security Manager policies
```

### 19.2 Target State

```text
Java 21 or 25 runtime
modern OSGi framework/container
API bundles low baseline where possible
implementation bundles Java 17/21+
jakarta migration planned, not accidental
Security Manager removed from threat model
untrusted extensions out-of-process
resolver tests in CI
baseline checks enforced
runtime diagnostics available
```

### 19.3 Migration Steps

#### Step 1: Inventory

Generate bundle catalog:

```text
symbolic name
version
exports
imports
bytecode
EE requirement
embedded libs
javax/jakarta usage
JDK internal usage
Security Manager usage
```

#### Step 2: Preserve Plugin API Compatibility

Keep rule plugin API Java 8/11 if external teams depend on it.

```text
com.acme.enforcement.rule.api       Java 8/11
com.acme.enforcement.rule.spi       Java 8/11
com.acme.enforcement.rule.runtime   Java 17/21
```

#### Step 3: Remove Java 8 Accidental APIs

Add explicit JAXB/Activation bundles or migrate to jakarta.

Do not let the JDK be the provider.

#### Step 4: Upgrade Tooling

Upgrade bnd, Karaf/Felix, SCR, bytecode libraries.

Run resolver tests before changing business logic.

#### Step 5: Introduce Compatibility Adapters

If old plugins expose javax validation but platform wants jakarta validation:

```text
legacy-validation-adapter
modern-validation-runtime
```

Keep conversion at one boundary.

#### Step 6: Replace Plugin Security Model

Old:

```text
same JVM + Security Manager policy
```

New:

```text
trusted signed plugin in same OSGi runtime
untrusted plugin in isolated worker service/container
```

#### Step 7: Adopt Virtual Threads Carefully

Use virtual threads for external connector calls only after:

- executor lifecycle is DS-managed;
- rate limits exist;
- connection pool limits exist;
- TCCL is controlled;
- bundle stop drains/cancels work.

#### Step 8: Canary and Rollback

Deploy a target Java runtime with representative bundle set.

Test:

- plugin install;
- plugin update;
- plugin removal;
- invalid config;
- missing service;
- database outage;
- bundle refresh;
- old plugin compatibility;
- memory leak after update.

---

## 20. Mental Model Summary

The key mental model:

```text
Java version compatibility is not one switch.
It is a contract stack.
```

The contract stack:

```text
Toolchain emits bytecode
    ↓
Bundle declares execution environment
    ↓
Manifest imports/export packages
    ↓
Framework resolves capabilities
    ↓
Classloaders enforce visibility
    ↓
JDK enforces platform rules
    ↓
Services operate dynamically
    ↓
Application behavior remains compatible
```

Java 8 to 25 migration fails when any layer is implicit.

Top-tier OSGi compatibility engineering makes each layer explicit:

- explicit bytecode target;
- explicit execution environment;
- explicit package imports;
- explicit javax/jakarta strategy;
- explicit reflection/access policy;
- explicit plugin trust model;
- explicit service lifecycle;
- explicit test matrix;
- explicit rollback path.

---

## 21. Practical Heuristics

Use these when designing or reviewing OSGi systems across Java 8–25.

### 21.1 API Baseline Heuristic

If external plugins implement or consume it, keep the Java baseline low unless there is a strong reason.

### 21.2 Implementation Freedom Heuristic

If only platform-owned code uses it, allow newer Java features, but declare EE accurately.

### 21.3 Namespace Heuristic

Do not expose `javax` or `jakarta` in long-lived domain/plugin APIs unless framework coupling is intentional.

### 21.4 Reflection Heuristic

Every reflective access issue should first trigger a library upgrade investigation, not a launch-flag addition.

### 21.5 Security Heuristic

Same-JVM OSGi isolation is not enough for untrusted code on Java 24/25.

### 21.6 Virtual Thread Heuristic

Use virtual threads to simplify blocking concurrency, not to bypass capacity limits.

### 21.7 Resolver Heuristic

If a bundle only works with `DynamicImport-Package: *`, the architecture is probably hiding an unresolved dependency model problem.

### 21.8 Migration Heuristic

Upgrade tooling before runtime. Old tools often cannot understand new bytecode.

---

## 22. Review Questions

Use these to test understanding.

1. Why is execution environment not the same as bytecode level?
2. Why can a Java 8-compiled bundle still require JavaSE-17?
3. Why is Java 11 a common cliff for older OSGi systems?
4. Why does OSGi make javax/jakarta migration more explicit than classpath applications?
5. Why is `--add-opens` migration debt?
6. Why can resolver success still be followed by `InaccessibleObjectException`?
7. Why should plugin API bundles often keep a lower Java baseline than implementation bundles?
8. Why do virtual threads not eliminate backpressure?
9. Why is Security Manager removal a major issue for old OSGi plugin-security assumptions?
10. Why should bytecode libraries be upgraded before compiling/running on Java 21/25?

---

## 23. References

- OSGi Core Release 8, Module Layer and Execution Environment / `Bundle-RequiredExecutionEnvironment` / capability model.
- OSGi Core Release 8, lifecycle, module, and service layer specifications.
- Equinox Execution Environment documentation.
- OpenJDK JEP 261: Module System.
- OpenJDK JEP 411: Deprecate the Security Manager for Removal.
- OpenJDK JEP 486: Permanently Disable the Security Manager.
- Oracle JDK 25 Security Guide: Security Manager permanently disabled.
- OpenJDK JDK 25 project and release materials.
- bnd/Bndtools documentation for manifest generation, baseline, resolver, and JPMS/MR-JAR handling.
- Apache Felix and Apache Karaf documentation for runtime compatibility and operational concerns.

---

## 24. Closing

Java 8 to 25 compatibility in OSGi is not just “upgrade the JDK”. It is runtime architecture work.

The most important shift is from accidental compatibility to declared compatibility.

Old systems often survive because the environment is permissive. Modern systems survive because the contracts are explicit, tested, and governed.

In the next part, we move from Java runtime compatibility into broader enterprise integration: CDI, Blueprint, Spring, Aries, CXF, and legacy enterprise stacks inside OSGi.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: 19 — JPMS and OSGi: Java Module System Interop from Java 9 to 25](./19-jpms-osgi-java-module-system-interop-java-9-to-25.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 21 — Enterprise Integration in OSGi: CDI, Blueprint, Spring, Aries, CXF, and Legacy Stacks](./21-enterprise-integration-osgi-cdi-blueprint-spring-aries-cxf-legacy-stacks.md)
