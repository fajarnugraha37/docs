# Part 18 — Security Model: Permissions, Conditional Permission Admin, Signing, and Sandboxing Reality

Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
File: `18-security-model-permissions-conditional-permission-admin-signing-sandboxing-reality.md`  
Target Java: 8 hingga 25  
Level: Advanced / platform engineering

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas messaging, events, async runtime, dan bridging ke sistem eksternal. Sekarang kita masuk ke salah satu area OSGi yang paling sering disalahpahami: **security model**.

Banyak engineer punya asumsi terlalu sederhana:

```text
OSGi = bundle isolation = aman
```

Asumsi itu keliru.

OSGi memang memberi isolation pada level **module visibility** dan **runtime lifecycle**, tetapi isolation tersebut bukan otomatis sama dengan sandbox keamanan. Bundle yang tidak bisa melihat package tertentu belum tentu tidak bisa melakukan operasi berbahaya seperti membaca file, membuka socket, membuat thread, menghabiskan memory, memakai reflection, atau memanggil API yang tidak kamu maksudkan.

Security di OSGi harus dipahami sebagai kombinasi beberapa lapisan:

```text
+---------------------------------------------------------------+
| Supply-chain security                                         |
| - siapa membuat bundle                                        |
| - dari repository mana bundle diambil                         |
| - apakah bundle ditandatangani                                |
| - apakah dependency diverifikasi                              |
+---------------------------------------------------------------+
| Runtime trust and deployment governance                       |
| - siapa boleh install/update bundle                           |
| - apakah hot deploy diizinkan                                 |
| - apakah shell/management API dibatasi                         |
+---------------------------------------------------------------+
| OSGi permission model                                         |
| - AdminPermission                                             |
| - ServicePermission                                           |
| - PackagePermission                                           |
| - BundlePermission                                            |
| - CapabilityPermission                                        |
| - Conditional Permission Admin                                |
+---------------------------------------------------------------+
| Java platform security reality                                |
| - Java Security Manager historically required                 |
| - deprecated in Java 17                                       |
| - permanently disabled from JDK 24 onward                     |
+---------------------------------------------------------------+
| OS/container/process isolation                                |
| - container profile                                           |
| - filesystem/network policy                                   |
| - IAM/secret policy                                           |
| - process boundary                                            |
+---------------------------------------------------------------+
| Application-level authorization                               |
| - user identity                                               |
| - tenant boundary                                             |
| - domain permissions                                          |
| - auditability                                                |
+---------------------------------------------------------------+
```

Target part ini adalah membuat kamu bisa berpikir realistis:

- apa yang OSGi Security Layer benar-benar lindungi;
- apa yang bergantung pada Java Security Manager;
- apa yang berubah di Java 17, 21, 24, 25;
- kapan permission model masih berguna;
- kapan harus memakai process/container isolation;
- bagaimana mendesain plugin platform yang defensible;
- bagaimana membedakan **module boundary**, **trust boundary**, dan **security boundary**.

> Top 1% engineer tidak bertanya “apakah OSGi aman?”. Mereka bertanya: “boundary keamanan apa yang kita klaim, mekanisme apa yang menegakkannya, failure mode apa yang masih tersisa, dan bagaimana kita membuktikannya secara operasional?”

---

## 2. Security Mental Model: Boundary Itu Tidak Sama

Dalam sistem OSGi, ada beberapa jenis boundary yang sering tercampur.

```text
+----------------------+--------------------------------------------+
| Boundary             | Meaning                                    |
+----------------------+--------------------------------------------+
| Package boundary     | Bundle tidak bisa load package tanpa wire  |
| Service boundary     | Bundle hanya memakai contract service      |
| Lifecycle boundary   | Bundle bisa start/stop/update terpisah     |
| Version boundary     | API package punya version range            |
| Trust boundary       | Bundle dianggap dipercaya/tidak dipercaya  |
| Permission boundary  | Operasi tertentu diizinkan/dilarang        |
| Process boundary     | OS memisahkan address space/resources      |
| Network boundary     | Traffic dibatasi policy/firewall/service   |
| Tenant boundary      | Data/aksi tenant dipisahkan secara domain  |
+----------------------+--------------------------------------------+
```

OSGi sangat kuat di package/service/lifecycle/version boundary. Tetapi trust/permission/process/tenant boundary perlu desain tambahan.

Contoh:

```text
Bundle A tidak meng-export com.acme.internal
Bundle B tidak bisa compile/import package itu
```

Ini bagus untuk modularity. Tetapi jika Bundle B masih punya akses filesystem penuh, network penuh, reflective access tertentu, dan secret environment variable, maka Bundle B tetap bisa menjadi risiko keamanan.

Dengan kata lain:

```text
module isolation != security isolation
```

OSGi modularity membantu security karena mengurangi accidental coupling dan membuat dependency eksplisit, tetapi tidak otomatis menjadi sandbox lengkap.

---

## 3. Historical Context: Kenapa OSGi Security Dibangun di Atas Java Permission Model

OSGi lahir di era ketika Java punya konsep kuat bernama:

```text
SecurityManager + AccessController + Permission
```

Model historisnya:

1. Code dimuat dari lokasi tertentu.
2. Code punya signer/certificate tertentu.
3. Policy memberi permission pada code source tertentu.
4. Saat code melakukan operasi sensitif, Java runtime melakukan permission check.
5. Permission check melihat call stack.
6. Jika ada code di call stack yang tidak punya permission, operasi ditolak.

OSGi memperluas model ini dengan konsep bundle:

```text
Bundle location + signer + permissions + lifecycle + service registry
```

Maka OSGi Security Layer mendefinisikan permission seperti:

- siapa boleh mengelola bundle;
- siapa boleh register/get service tertentu;
- siapa boleh import/export package tertentu;
- siapa boleh require/provide capability tertentu;
- siapa boleh memakai lifecycle operation tertentu.

Namun ada konsekuensi penting:

> Banyak mekanisme permission OSGi historis bergantung pada Java permission checking runtime. Ketika Java Security Manager tidak aktif atau tidak tersedia, sebagian klaim sandboxing code-level tidak lagi berdiri seperti dulu.

Ini sangat penting untuk Java 8 sampai 25.

---

## 4. Java 8 hingga 25: Security Manager Reality

### 4.1 Java 8

Di Java 8, Security Manager masih tersedia penuh dan lebih umum dipakai oleh container/platform lama.

OSGi security model secara historis paling masuk akal pada era ini:

```text
Java 8 + SecurityManager + OSGi Conditional Permission Admin
```

Pada kombinasi ini, kamu bisa membuat kebijakan code permission yang relatif granular.

Contoh konsep:

```text
Bundle dari location tertentu boleh register service X
Bundle yang ditandatangani vendor tertentu boleh membuka socket ke host tertentu
Bundle plugin pihak ketiga tidak boleh mengakses file tertentu
```

Tetapi sekalipun di Java 8, model ini sulit dioperasikan:

- policy kompleks;
- library sering tidak didesain dengan permission minim;
- banyak framework membutuhkan permission luas;
- debugging AccessControlException tidak mudah;
- performance dan maintainability menjadi isu.

### 4.2 Java 9 sampai 16

Java 9 memperkenalkan JPMS dan strong encapsulation bertahap. Ini memengaruhi OSGi terutama pada reflection dan akses internal JDK.

Tetapi Security Manager masih ada.

Masalah baru:

- library lama memakai internal JDK API;
- reflective access mulai dibatasi;
- module boundary JPMS kadang bentrok dengan asumsi lama;
- command line flags seperti `--add-opens` mulai muncul.

### 4.3 Java 17

Java 17 mendeprecate Security Manager for removal lewat JEP 411. Artinya secara strategis, platform Java mulai meninggalkan model sandbox berbasis Security Manager.

Dampaknya untuk OSGi:

```text
OSGi permission model tidak boleh lagi dijadikan satu-satunya fondasi sandbox jangka panjang.
```

Untuk runtime modern Java 17+, kamu harus mulai mengalihkan sebagian security boundary ke:

- process isolation;
- container security;
- Kubernetes/network policy;
- OS user permissions;
- filesystem mount policy;
- seccomp/AppArmor/SELinux;
- IAM/cloud policy;
- plugin certification;
- repository trust;
- service-level authorization;
- static scanning dan supply-chain verification.

### 4.4 Java 21

Java 21 adalah LTS modern yang banyak dipakai enterprise. Security Manager sudah deprecated dan secara desain bukan masa depan.

Masih mungkin ada sistem lama yang memakai security manager di Java 21, tetapi desain baru sebaiknya tidak bergantung padanya untuk sandbox plugin tidak dipercaya.

### 4.5 Java 24 dan Java 25

Mulai JDK 24, Security Manager secara efektif permanently disabled. Untuk Java 25, desain OSGi security harus realistis:

```text
Java 25 OSGi security = modularity + governance + process/container controls + application authorization + supply-chain controls
```

Bukan:

```text
Java 25 OSGi security = in-JVM sandbox untrusted code with SecurityManager
```

Ringkasan:

```text
+---------+----------------------------+---------------------------------------------+
| Java    | Security Manager Status    | OSGi Security Implication                   |
+---------+----------------------------+---------------------------------------------+
| 8       | Available                  | Classic OSGi permission model viable        |
| 9-16    | Available, JPMS emerging   | Viable but more reflective/module friction  |
| 17      | Deprecated for removal     | Do not design new sandbox around it         |
| 21      | Deprecated legacy          | Treat as compatibility, not strategy        |
| 24      | Permanently disabled       | In-JVM permission sandbox no longer viable  |
| 25      | Disabled continuation      | Use external/process/governance controls    |
+---------+----------------------------+---------------------------------------------+
```

---

## 5. OSGi Security Layer: What It Was Designed to Control

OSGi Security Layer addresses control over framework/module/service operations.

It answers questions like:

```text
Can this bundle register this service?
Can this bundle get this service?
Can this bundle import/export this package?
Can this bundle require/provide this capability?
Can this actor install/update/uninstall bundles?
Can this bundle access another bundle's metadata/resources?
```

This is different from application authorization:

```text
Can user Fajar approve enforcement case #123?
Can officer A view agency B's documents?
Can tenant X trigger escalation Y?
```

Those are domain-level decisions. OSGi does not solve them directly.

OSGi security is more about:

```text
code/module authorization
```

Application security is more about:

```text
user/domain/data/action authorization
```

A robust platform usually needs both.

---

## 6. Core OSGi Permission Types

### 6.1 AdminPermission

`AdminPermission` controls administrative operations on bundles and framework resources.

Examples of protected actions include concepts like:

- lifecycle management;
- metadata access;
- resource access;
- class access;
- context access;
- extension lifecycle;
- execute operations.

Mental model:

```text
AdminPermission is about who can control or introspect bundles.
```

Risk if too broad:

```text
A malicious/buggy bundle can stop another bundle, update it, read resources, or manipulate runtime state.
```

Design rule:

```text
Only management agents, deployment agents, and trusted runtime infrastructure should have broad AdminPermission.
```

Application bundles usually should not.

### 6.2 ServicePermission

`ServicePermission` controls service registry access.

It can govern:

- registering service under a class/interface name;
- getting service of a class/interface name.

Mental model:

```text
ServicePermission protects capability publication and capability consumption.
```

Example risks:

1. Malicious bundle registers fake `PaymentGateway` service with higher ranking.
2. Malicious bundle gets sensitive `SecretProvider` service.
3. Plugin registers service under API it should not implement.
4. Bundle obtains management service and changes runtime.

ServicePermission is very relevant to plugin platform governance.

Without permission enforcement, you should still enforce governance through:

- package visibility;
- service target filters;
- marker properties;
- repository certification;
- runtime registration validation;
- custom extender validation;
- service proxy authorization.

### 6.3 PackagePermission

`PackagePermission` controls package import/export access.

Mental model:

```text
PackagePermission protects class visibility beyond resolver metadata.
```

It can restrict who may import/export packages.

Potential use cases:

- only trusted bundles can import internal management APIs;
- only approved API bundles can export public platform packages;
- plugin bundles cannot import kernel internal packages even if accidentally exported.

In practice, package boundary should first be enforced by correct OSGi metadata:

```text
Do not export internal packages.
```

Then permission can be a second layer when available.

### 6.4 BundlePermission

`BundlePermission` is related to requiring/providing bundles in certain namespace contexts.

In modern design, because `Require-Bundle` should be used sparingly, this permission is less central than ServicePermission and PackagePermission for most systems.

### 6.5 CapabilityPermission

`CapabilityPermission` controls generic capabilities.

This becomes relevant when your architecture uses:

- `Provide-Capability`;
- `Require-Capability`;
- extender namespaces;
- custom namespaces;
- feature/capability-driven plugin admission.

Mental model:

```text
CapabilityPermission protects abstract runtime capabilities, not just Java packages.
```

Example:

```text
Only certified bundles may provide capability:
  com.acme.enforcement.rule;type=escalation
```

This can be useful in a platform where runtime plugins advertise capabilities.

### 6.6 AdaptPermission

`AdaptPermission` controls adaptation of bundle objects to other types.

In OSGi, `adapt()` can expose views such as wiring, revisions, service objects, DTOs, and other management representations depending on the framework/service.

Mental model:

```text
AdaptPermission protects privileged introspection and conversion of runtime objects.
```

### 6.7 Coordination with Java Permissions

OSGi-specific permissions often sit alongside Java platform permissions such as:

- `FilePermission`;
- `SocketPermission`;
- `RuntimePermission`;
- `ReflectPermission`;
- `PropertyPermission`;
- `LoggingPermission`;
- security provider permissions.

A secure OSGi runtime on Java 8 historically needed both:

```text
OSGi permissions + Java permissions
```

Example:

```text
Bundle can get HttpClient service
but cannot open arbitrary socket unless SocketPermission allows it
```

On Java 24/25, because Security Manager is disabled, these permission checks cannot be assumed as an active sandbox.

---

## 7. Permission Admin vs Conditional Permission Admin

OSGi has two important permission administration ideas:

1. Permission Admin
2. Conditional Permission Admin

### 7.1 Permission Admin

Permission Admin is simpler.

It maps bundle location to permissions.

Mental model:

```text
bundle location -> permission set
```

Example concept:

```text
location: file:/plugins/reporting.jar
permissions:
  ServicePermission[com.acme.report.ReportRenderer, register]
  ServicePermission[com.acme.config.ConfigReader, get]
```

Limitations:

- location-based policy can be brittle;
- difficult to express signer-based trust;
- less flexible than conditional model;
- dynamic policy evolution is limited.

### 7.2 Conditional Permission Admin

Conditional Permission Admin is more powerful.

It maintains an ordered policy table of conditional permission entries. Conditions can evaluate things like:

- bundle location;
- bundle signer;
- bundle symbolic name;
- custom conditions;
- runtime condition state.

Mental model:

```text
if conditions match bundle/code context:
    allow or deny permissions
```

Policy table ordering matters. This is very important.

```text
+-------+----------------------------+--------------------------+--------+
| Order | Condition                  | Permission               | Access |
+-------+----------------------------+--------------------------+--------+
| 1     | signer=TrustedVendor       | ServicePermission X get  | allow  |
| 2     | location=/plugins/third    | SocketPermission *       | deny   |
| 3     | bundle=platform.kernel     | AdminPermission *        | allow  |
+-------+----------------------------+--------------------------+--------+
```

Because it is ordered, a broad rule above a narrow rule can change the result.

### 7.3 Why Conditional Permission Admin Exists

Static location permission is not enough for real platforms.

You may need to say:

```text
Allow bundle to register EnforcementRule only if:
- it is signed by approved vendor;
- it comes from certified plugin repository;
- its symbolic name matches allowed namespace;
- it declares approved capability;
- it does not request forbidden permissions.
```

Conditional Permission Admin provides a standard model for conditional policy.

### 7.4 The Java 24/25 Problem

Classic CPA was meaningful because Java permission checks existed.

On modern Java where Security Manager is permanently disabled, CPA remains important historically and conceptually, but cannot be treated as the complete enforcement story for arbitrary dangerous operations.

Design implication:

```text
Use CPA knowledge to understand legacy systems and Java 8/11/17 deployments.
For Java 24/25 systems, shift untrusted-code security to process/container/plugin certification boundaries.
```

---

## 8. Bundle Signing and Trust

Bundle signing is about verifying origin and integrity.

It answers:

```text
Was this bundle produced by an entity we trust?
Was it modified after signing?
Can policy depend on signer identity?
```

It does not answer:

```text
Is the code bug-free?
Is the code safe?
Is the code authorized to access this tenant's data?
Will the code behave efficiently?
```

Signing is a trust input, not a full security guarantee.

### 8.1 What Signing Helps With

Bundle signing helps with:

- supply-chain integrity;
- plugin certification;
- vendor attribution;
- policy condition based on signer;
- tamper detection;
- controlled repository admission.

### 8.2 What Signing Does Not Help With

Signing does not prevent:

- vulnerable code;
- malicious but signed code from a compromised vendor;
- over-permissioned code;
- logic bugs;
- data exfiltration if network is open;
- resource exhaustion;
- lifecycle abuse;
- stale dependency vulnerabilities.

### 8.3 Practical Signing Workflow

A practical plugin platform may use this workflow:

```text
Developer builds plugin bundle
      |
      v
CI validates manifest/package imports/baseline
      |
      v
Security scan dependencies and SBOM
      |
      v
Integration tests against platform certification kit
      |
      v
Bundle is signed by trusted signing key
      |
      v
Bundle is published to approved repository
      |
      v
Runtime installs only from approved repository
      |
      v
Runtime validates signer and metadata before activation
```

Signing belongs in a bigger governance flow.

---

## 9. Security Boundary Taxonomy for OSGi Plugin Platforms

A top-tier OSGi design must explicitly classify plugins.

### 9.1 Fully Trusted Internal Bundle

Example:

```text
platform.kernel
platform.persistence
platform.security
platform.config
```

Properties:

- developed by core platform team;
- full CI/CD control;
- broad runtime capability;
- can access internal APIs;
- can manage lifecycle/config.

Security posture:

```text
Trust high, but still audit and least privilege where practical.
```

### 9.2 Trusted Partner Bundle

Example:

```text
vendor.singpass.connector
vendor.payment.connector
vendor.document.renderer
```

Properties:

- developed outside core team;
- certified through contract/testing;
- signed;
- allowed limited APIs;
- must follow compatibility rules.

Security posture:

```text
Trust conditional. Require signing, scanning, certification, monitoring.
```

### 9.3 Semi-Trusted Configurable Extension

Example:

```text
rule bundle generated from DSL
workflow policy bundle
template renderer bundle
```

Properties:

- not arbitrary Java code;
- generated from restricted DSL/template;
- validated before runtime;
- no direct filesystem/network access.

Security posture:

```text
Prefer restricted DSL over arbitrary plugin code when user extensibility is needed.
```

### 9.4 Untrusted Third-Party Arbitrary Code

Example:

```text
random marketplace plugin with arbitrary Java classes
```

Security posture on Java 24/25:

```text
Do not run arbitrary untrusted Java plugin code inside same JVM and claim strong sandboxing.
```

Use process/container isolation.

Possible architecture:

```text
+--------------------------+      gRPC/HTTP/message      +--------------------------+
| Trusted OSGi Platform    | <--------------------------> | Untrusted Plugin Process |
| same JVM trusted code    |                              | container sandbox        |
+--------------------------+                              +--------------------------+
```

---

## 10. Module Boundary vs Security Boundary: Concrete Examples

### Example 1 — Hidden Package Is Not a Sandbox

```text
platform.kernel exports:
  com.acme.platform.api

platform.kernel does not export:
  com.acme.platform.internal
```

Plugin cannot import `com.acme.platform.internal` normally.

Good.

But plugin may still:

- open outbound HTTP to attacker;
- read environment variables;
- consume CPU;
- allocate memory;
- register misleading service;
- invoke public API in abusive ways.

Conclusion:

```text
Package hiding protects architecture, not all security risks.
```

### Example 2 — Service Registry Spoofing

Suppose API:

```java
public interface IdentityProvider {
    Principal authenticate(Token token);
}
```

If any bundle can register this interface, a malicious bundle may register:

```text
service.ranking = 99999
```

Then consumers may bind to fake provider.

Mitigations:

- restrict who can register sensitive services;
- use target filters requiring trusted marker property;
- do not select only by ranking for security-sensitive service;
- verify service bundle signer/location;
- use whiteboard/extender that validates providers;
- make sensitive provider registration internal to kernel.

### Example 3 — Management Shell Exposure

Karaf/Felix/Equinox consoles are powerful.

If exposed improperly, attacker can:

- list bundles;
- install bundles;
- stop security bundle;
- inspect config;
- change runtime;
- access secrets indirectly.

Mitigations:

- disable remote shell unless needed;
- bind shell to localhost/private network;
- strong auth;
- least privileged roles;
- audit commands;
- separate operations network;
- avoid production hot install through shell;
- treat shell as privileged root equivalent.

### Example 4 — Config Admin Abuse

Config Admin can modify runtime behavior.

If a plugin can update sensitive PID:

```text
com.acme.security.oauth
com.acme.datasource.main
com.acme.audit.sink
```

It can redirect traffic, disable audit, or leak credentials.

Mitigations:

- restrict Config Admin access;
- validate config updates;
- do not store raw secrets in config;
- audit changes;
- separate config update agent from app bundles;
- use immutable deployment for sensitive config.

---

## 11. Service Registry Security Patterns

### 11.1 Sensitive Service Must Not Be Plainly Discoverable

Bad:

```java
@Component(service = SecretProvider.class)
public class VaultSecretProvider implements SecretProvider {
    ...
}
```

Any bundle with visibility can try to get `SecretProvider`.

Better options:

1. Keep sensitive service interface in internal non-exported package.
2. Expose only narrow purpose-specific API.
3. Use authorization-aware methods.
4. Validate caller context if available.
5. Use service properties and controlled target filters.
6. Register sensitive service only to trusted mediator.

Example:

```java
public interface ExternalConnectorCredentialProvider {
    CredentialRef getCredentialRef(String connectorId);
}
```

Better than exposing raw secret values.

### 11.2 Security-Sensitive Service Selection Must Not Depend on Ranking Alone

Bad:

```java
@Reference
IdentityProvider identityProvider;
```

This binds to highest-ranked available provider.

Better:

```java
@Reference(target = "(provider.id=platform-keycloak)")
IdentityProvider identityProvider;
```

Even better for highly sensitive service:

- do not allow external implementations;
- bind internally;
- validate provider bundle;
- use explicit configuration mapping;
- fail closed if unexpected provider appears.

### 11.3 Whiteboard Registration Validation

In plugin systems, instead of letting arbitrary services be consumed directly, use a registry/manager component.

```text
Plugin registers RuleProvider service
       |
       v
RuleRegistry observes provider
       |
       v
RuleRegistry validates:
  - bundle symbolic name
  - bundle version
  - signer
  - capability
  - declared metadata
  - certification marker
  - config scope
       |
       v
Only validated rules exposed to engine
```

This prevents application engine from binding blindly to arbitrary plugin services.

### 11.4 Service Proxy Authorization

For sensitive operations, expose a proxy that enforces domain authorization.

```text
Plugin -> CaseActionService proxy -> AuthorizationService -> Domain service
```

The plugin never gets direct access to repository or internal domain service.

---

## 12. Package Export Security Patterns

### 12.1 Export Only API Packages

Bad:

```properties
Export-Package: com.acme.*
```

This accidentally exposes internals.

Better:

```properties
Export-Package: \
  com.acme.enforcement.api;version="1.4.0",\
  com.acme.enforcement.spi;version="1.2.0"
Private-Package: \
  com.acme.enforcement.internal.*
```

### 12.2 API/SPI/Internal Separation

Use package naming intentionally:

```text
com.acme.case.api          stable consumer API
com.acme.case.spi          provider extension API
com.acme.case.dto          versioned data boundary
com.acme.case.internal     hidden implementation
com.acme.case.impl         hidden implementation
```

Security benefit:

- plugins cannot easily depend on internals;
- review surface is smaller;
- exported packages become auditable contracts.

### 12.3 Avoid Friend/Internal Exports Unless Runtime Supports Enforcement

Some ecosystems use conventions like:

```text
x-internal:=true
x-friends:=...
```

These are often tooling conventions, not universal hard security enforcement.

Do not treat them as a strong trust boundary unless your runtime/tooling actually enforces them.

### 12.4 Avoid Split Package

Split packages are bad for resolver correctness and security review.

```text
Bundle A exports com.acme.security
Bundle B exports com.acme.security
```

This creates ambiguity:

- which bundle owns API?
- which version is authoritative?
- which code is trusted?
- how do you review changes?

Security-sensitive packages should have a single owner.

---

## 13. Capability-Based Admission

OSGi capabilities can be used as explicit runtime claims.

Example:

```properties
Provide-Capability: \
  com.acme.plugin;\
    type="enforcement-rule";\
    plugin.id="late-fee-rule";\
    certification="2026-Q2";\
    risk="medium"
```

Runtime can require:

```properties
Require-Capability: \
  com.acme.platform;\
    filter:="(&(platform=enforcement)(api.version>=2.0.0))"
```

This allows a plugin ecosystem where bundles declare structured metadata.

But do not blindly trust self-declared capability.

Use capability as:

```text
claim input
```

Then validate against:

- signer;
- repository metadata;
- certification database;
- policy rules;
- manifest review;
- compatibility test result.

---

## 14. Plugin Security Architecture for Regulated Systems

For regulatory systems, plugins often represent business rules:

- enforcement escalation;
- case risk scoring;
- document template rendering;
- notification routing;
- agency integration connector;
- validation rule;
- approval precondition;
- audit enrichment.

These plugins may affect legal/operational outcomes. Therefore security is not only about attacker prevention. It is also about **defensibility**.

Questions to answer:

1. Who authored the plugin?
2. Who approved it?
3. Which version ran for case X?
4. Which configuration was active?
5. Which services did it use?
6. Which data did it read/write?
7. Was its result deterministic?
8. Can we reproduce the decision later?
9. Can we rollback safely?
10. Can we prove no unauthorized plugin was active?

### 14.1 Recommended Regulatory Plugin Model

```text
+-------------------------------------------------------------+
| Platform Kernel                                             |
| - authn/authz                                               |
| - audit                                                     |
| - config validation                                         |
| - plugin admission                                          |
| - runtime registry                                          |
+-------------------------------------------------------------+
        ^                  ^                       ^
        | service API       | event API             | config API
        v                  v                       v
+----------------+  +----------------+  +--------------------+
| Rule Plugin    |  | Renderer Plugin |  | Connector Plugin   |
| signed         |  | signed          |  | signed             |
| certified      |  | certified       |  | certified          |
+----------------+  +----------------+  +--------------------+
```

Each plugin should have:

```text
- Bundle-SymbolicName
- Bundle-Version
- plugin metadata
- API compatibility declaration
- signer/certificate
- SBOM
- certification test result
- allowed service list
- allowed config PID list
- audit category
- owner/team/vendor
```

### 14.2 Runtime Admission Flow

```text
Bundle installed
   |
   v
Manifest read
   |
   v
Signer verified
   |
   v
Symbolic name/version checked
   |
   v
Capability metadata checked
   |
   v
Imports checked against allowlist
   |
   v
Forbidden packages checked
   |
   v
Services declared/observed
   |
   v
Config scope validated
   |
   v
Plugin registered as candidate
   |
   v
Health check executed
   |
   v
Plugin activated for tenant/context
```

Do not let installation equal activation.

```text
installed != trusted != admitted != active-for-domain-use
```

### 14.3 Runtime Decision Audit

For a plugin-driven decision, audit:

```text
caseId=CASE-123
operation=ESCALATION_EVALUATION
plugin.symbolicName=com.acme.rules.lateFee
plugin.version=2.3.1
plugin.signer=CN=Acme Approved Plugin Signing
plugin.configVersion=17
inputHash=...
output=ESCALATE
outputReason=late fee > threshold
platform.apiVersion=4.1.0
runtimeId=osgi-prod-3
timestamp=2026-06-18T...
```

This is much more useful than only logging:

```text
Rule executed successfully
```

---

## 15. Sandboxing Reality: What You Can and Cannot Claim

### 15.1 Strong Claim You Should Avoid on Java 24/25

Avoid claiming:

```text
We can safely run arbitrary untrusted Java bundles in the same JVM using OSGi sandboxing.
```

That is not a defensible modern claim.

### 15.2 More Defensible Claim

Better:

```text
We run trusted or certified bundles in the same OSGi JVM.
We enforce modular boundaries, service governance, signed artifact admission,
repository controls, runtime audit, and least-privilege operational access.
Untrusted code runs outside the JVM in a separate process/container.
```

### 15.3 For Java 8 Legacy Systems

For Java 8 systems with Security Manager enabled, you may claim a stronger in-JVM permission model, but only if:

- policy is actually active;
- permissions are tested;
- bundles do not all have `AllPermission`;
- dangerous operations are covered;
- framework and libraries support restricted permission mode;
- you have negative tests proving denial;
- operational changes do not bypass policy.

### 15.4 Sandbox Alternatives

For untrusted plugin execution, consider:

```text
+----------------------+---------------------------------------------+
| Mechanism            | Use Case                                    |
+----------------------+---------------------------------------------+
| Separate process     | Stronger isolation than same JVM           |
| Container            | Filesystem/network/resource controls       |
| WASM runtime         | Restricted plugin execution model          |
| DSL/rule engine      | Controlled business extensibility          |
| Scripting sandbox    | Limited, must be reviewed carefully         |
| Remote plugin worker | Plugin isolated by network/process          |
| Serverless function  | External execution lifecycle                |
+----------------------+---------------------------------------------+
```

For regulated systems, DSL/rule models are often better than arbitrary Java plugin code.

---

## 16. Supply-Chain Security for OSGi Bundles

OSGi systems tend to have many bundles. This increases supply-chain surface.

### 16.1 Artifact Identity

Track:

```text
- Maven coordinates
- Bundle-SymbolicName
- Bundle-Version
- package exports
- package imports
- signer
- checksum
- source repository
- build pipeline
- SBOM
- license
- vulnerability scan result
```

Bundle identity and Maven identity are not always the same.

```text
Maven: groupId:artifactId:version
OSGi: Bundle-SymbolicName:Bundle-Version
```

Both matter.

### 16.2 Repository Trust

Do not let production runtime install arbitrary bundles from arbitrary Maven coordinates.

Recommended:

```text
Public Maven Central
    |
    v
Internal artifact mirror
    |
    v
Scanning/SBOM/license policy
    |
    v
Approved OSGi repository/index
    |
    v
Environment-specific deployment repository
    |
    v
Runtime provisioning
```

### 16.3 Dependency Wrapping Risk

Wrapping non-OSGi libraries into bundles can hide vulnerabilities if metadata is not tracked.

Example:

```text
com.acme.wrap.jackson.databind
```

Must still map back to:

```text
com.fasterxml.jackson.core:jackson-databind:2.x.y
```

Otherwise SBOM/vulnerability tracking breaks.

### 16.4 Embedded Dependency Risk

A bundle may embed JARs via `Bundle-ClassPath`.

This can hide transitive dependencies from runtime-level inventory.

Policy:

- avoid embedding unless needed;
- document embedded artifacts;
- include them in SBOM;
- scan embedded JARs;
- avoid duplicate embedded copies of sensitive libraries;
- baseline and version them.

---

## 17. Management Surface Security

OSGi runtimes often expose management tools:

- Gogo shell;
- Karaf shell;
- Equinox console;
- Web Console;
- JMX;
- REST management endpoints;
- FileInstall deploy folder;
- p2/Karaf feature repositories;
- custom admin UI.

These are high-risk.

### 17.1 Shell Hardening

Checklist:

```text
[ ] Remote shell disabled unless explicitly required
[ ] Shell bound to private/admin network
[ ] Strong authentication enabled
[ ] Authorization roles separated
[ ] Command audit enabled
[ ] No shared admin credentials
[ ] No production install/update from ad-hoc shell without change record
[ ] Shell access included in incident response logging
```

### 17.2 Web Console Hardening

Checklist:

```text
[ ] Disabled in production unless required
[ ] Protected by strong auth
[ ] Behind admin network/VPN
[ ] CSRF protection where applicable
[ ] No default credentials
[ ] No sensitive config displayed
[ ] Access logged
```

### 17.3 Deploy Folder Hardening

Karaf/Felix FileInstall style deploy folders are convenient but dangerous.

Risk:

```text
Attacker writes JAR to deploy folder -> runtime installs it
```

Mitigations:

- production deploy folder read-only;
- no shared writable volume;
- deploy through controlled pipeline;
- validate signer before activation;
- disable hot deploy in high assurance environments;
- monitor filesystem changes.

### 17.4 JMX Hardening

JMX can expose powerful operations.

Checklist:

```text
[ ] No unauthenticated JMX
[ ] TLS where remote
[ ] Role separation
[ ] MBean operation audit
[ ] Firewall restricted
[ ] Avoid exposing bundle lifecycle operations broadly
```

---

## 18. Configuration and Secret Security

Configuration Admin is not a secret manager.

Bad:

```text
com.acme.db.password = plaintext
com.acme.jwt.signingKey = plaintext
com.acme.smtp.password = plaintext
```

Better:

```text
com.acme.db.passwordRef = secret://prod/db/main/password
com.acme.jwt.signingKeyRef = kms://key/alias/platform-jwt
```

The runtime secret provider resolves references under controlled policy.

### 18.1 Config PID Ownership

Each PID should have an owner.

```text
PID: com.acme.datasource.main
Owner: platform-runtime-team
Writable by: deployment agent only
Readable by: datasource bundle only
Audit: required
```

### 18.2 Config Update Authorization

Do not let arbitrary bundles update config.

Sensitive config includes:

- auth provider;
- token signing;
- datasource;
- audit sinks;
- outbound proxy;
- plugin admission policy;
- feature flags for security behavior;
- encryption keys;
- SMTP/notification credentials.

### 18.3 Config Change Audit

Audit should include:

```text
pid
factoryPid if any
changedBy
changeSource
oldVersion
newVersion
sensitiveFieldsRedacted
validationResult
activationResult
timestamp
```

---

## 19. Runtime Authorization Inside Services

OSGi ServicePermission may control code access to service, but domain authorization must live inside application logic.

Example:

```java
public interface CaseActionService {
    void approveCase(CaseId caseId, UserContext userContext);
}
```

Service implementation must enforce:

- user role;
- tenant/agency scope;
- case state;
- conflict of interest;
- approval delegation;
- audit trail;
- time constraints;
- policy version.

Do not rely on bundle identity for user authorization.

Bad mental model:

```text
Plugin bundle is trusted, therefore all actions are allowed.
```

Better:

```text
Plugin bundle is allowed to request action.
Domain service still authorizes action under user/system context.
```

---

## 20. Caller Identity Problem in OSGi

In a service registry, service consumer calls provider directly. The provider may not know which bundle called it unless using framework/security mechanisms or explicit context.

For security-sensitive APIs, do not rely on implicit caller identity.

Instead pass explicit context:

```java
public interface DocumentRenderService {
    RenderResult render(RenderRequest request, ExecutionContext context);
}
```

Where `ExecutionContext` contains:

```text
- user identity or system identity
- tenant/agency
- correlation ID
- request ID
- permission scope
- purpose of use
- audit metadata
```

For plugin execution, create platform-managed context:

```text
RuleEngine creates ExecutionContext
Plugin receives limited context
Plugin cannot forge privileged context
Domain services validate context token/scope
```

---

## 21. Resource Exhaustion Risks

Even trusted bundles can harm runtime through resource exhaustion.

Examples:

- infinite loop in plugin;
- unbounded memory allocation;
- unbounded thread creation;
- unbounded event publishing;
- blocking DS activation;
- leaking classloaders after update;
- unbounded executor queue;
- opening too many sockets/files;
- heavy reflection/scan at startup.

OSGi permissions alone do not solve resource governance, especially on modern Java.

Mitigations:

- plugin execution timeout;
- bounded executor;
- queue limits;
- rate limiting;
- circuit breaker;
- per-plugin metrics;
- health/quarantine;
- separate process for high-risk plugins;
- memory/CPU limits at container/process level;
- activation time budget;
- event publication limits.

Example plugin execution guard:

```text
Rule invocation
   |
   v
ExecutionManager
   - timeout: 2 seconds
   - max concurrency: 8
   - circuit breaker
   - audit each failure
   - quarantine after threshold
   |
   v
Plugin service
```

---

## 22. Network Security in OSGi Runtime

If plugin bundles can open network connections freely, they can exfiltrate data.

On Java 8 with Security Manager, `SocketPermission` might restrict this.

On Java 24/25, use infrastructure controls:

- Kubernetes NetworkPolicy;
- service mesh egress policy;
- firewall rules;
- outbound proxy allowlist;
- DNS policy;
- container runtime policy;
- separate namespace/subnet;
- cloud IAM/service account scoping.

Design pattern:

```text
Plugins do not create arbitrary HttpClient.
Plugins request outbound call through ConnectorGateway service.
ConnectorGateway enforces:
  - destination allowlist
  - credential scope
  - audit
  - rate limit
  - timeout
  - redaction
```

This gives you security and observability.

---

## 23. Filesystem Security

Avoid giving plugins direct file access.

Common risks:

- reading secrets from mounted path;
- writing malicious bundle into deploy folder;
- corrupting local cache;
- reading logs with PII;
- writing large files and filling disk;
- reading service account tokens.

Patterns:

```text
Direct file access -> StorageService abstraction
Direct temp file -> TempFileService with quota
Direct resource read -> ResourceProvider service
Direct document write -> DocumentStore service
```

Enforce:

- path allowlist;
- quota;
- file type validation;
- scanning;
- audit;
- cleanup.

---

## 24. Reflection, Proxies, and Bytecode Generation Risks

OSGi systems often use reflection for:

- DS annotations;
- JAX-RS scanning;
- JPA entity scanning;
- JSON binding;
- proxies;
- bytecode enhancement;
- scripting;
- template engines.

Security risks:

- accessing non-public members;
- invoking unexpected methods;
- generating classes in wrong classloader;
- bypassing intended API boundary;
- deserialization gadgets;
- plugin-controlled class names;
- expression language injection.

Mitigations:

- avoid arbitrary class name loading from config;
- validate allowed classes/packages;
- avoid exposing unrestricted scripting/expression engines;
- use safe template mode;
- keep deserialization restricted;
- isolate bytecode generation libraries;
- avoid broad `--add-opens` in production;
- review reflection-heavy libraries under JPMS Java 17+.

---

## 25. Deserialization and Classloader Security

OSGi classloader diversity affects deserialization.

Risks:

- serialized object from one bundle deserialized in another classloader;
- gadget chains from embedded libraries;
- class identity mismatch;
- loading unexpected classes;
- plugin-provided class as payload type.

Rules:

1. Prefer JSON/protobuf/Avro DTO over Java serialization.
2. Use allowlist of DTO classes.
3. Do not deserialize plugin-provided classes in kernel.
4. Keep event payloads simple and versioned.
5. Avoid passing ORM entities across bundle/plugin boundary.
6. Use context-free DTO packages owned by API bundle.

---

## 26. OSGi Security and Jakarta/Javax Transition

The `javax` to `jakarta` transition affects security too.

Examples:

- Servlet security APIs;
- JAX-RS filters;
- CDI interceptors;
- Bean Validation;
- Persistence providers;
- XML/JAXB packages;
- Mail/Activation.

Potential risks:

- both `javax.*` and `jakarta.*` APIs present;
- plugin compiled against old namespace;
- duplicate provider registration;
- security filters not invoked because registered under wrong API;
- runtime binds to unexpected provider;
- classloading conflict hides intended security component.

Design rule:

```text
Do not mix javax and jakarta security-sensitive extension APIs casually.
Make namespace compatibility explicit per runtime distribution.
```

---

## 27. Java 8–25 Security Compatibility Matrix

```text
+--------------+-----------------------------+---------------------------------------------+
| Area         | Java 8                       | Java 17/21/25                               |
+--------------+-----------------------------+---------------------------------------------+
| SecurityMgr  | Available                    | Deprecated/disabled trajectory              |
| OSGi perms   | Can be active sandbox layer  | Mostly governance/legacy unless supported   |
| Reflection   | Broad access easier          | Stronger encapsulation, add-opens concerns  |
| javax APIs   | Built-in Java EE modules     | Removed, external dependencies needed       |
| TLS/security | Older defaults               | Stronger defaults, provider changes         |
| Sandbox      | Possible but complex         | Prefer process/container isolation          |
| Plugin risk  | CPA can help                 | Certification + isolation architecture      |
+--------------+-----------------------------+---------------------------------------------+
```

For new systems targeting Java 21/25:

```text
Design security as if same-JVM arbitrary untrusted code is not safely sandboxable.
```

---

## 28. Case Study: Secure Enforcement Rule Plugin Platform

### 28.1 Requirements

We need a platform where agencies can deploy rule plugins that influence enforcement lifecycle.

Rules can:

- validate case completeness;
- determine escalation eligibility;
- calculate risk score;
- select correspondence template;
- recommend next action.

Risks:

- unauthorized rule changes legal outcome;
- rule reads data outside scope;
- rule exfiltrates data;
- rule hangs production;
- incompatible rule breaks runtime;
- old rule version cannot be reproduced;
- malicious service registration spoofs platform service.

### 28.2 Architecture

```text
+----------------------------------------------------------+
| Enforcement Platform Kernel                              |
|                                                          |
|  +--------------------+     +--------------------------+  |
|  | PluginAdmissionSvc | --> | ApprovedPluginRegistry   |  |
|  +--------------------+     +--------------------------+  |
|            |                            |                 |
|            v                            v                 |
|  +--------------------+     +--------------------------+  |
|  | RuleExecutionMgr   | --> | AuditService             |  |
|  +--------------------+     +--------------------------+  |
|            |                                              |
|            v                                              |
|  +--------------------+                                   |
|  | DomainServiceProxy |                                   |
|  +--------------------+                                   |
+----------------------------------------------------------+
             ^
             |
             v
+----------------------------+
| Rule Plugin Bundle         |
| - signed                   |
| - certified                |
| - exposes RuleProvider SPI |
| - no direct DB             |
| - no direct secret         |
+----------------------------+
```

### 28.3 Rule SPI

```java
package com.acme.enforcement.rule.spi;

public interface EnforcementRule {
    RuleResult evaluate(RuleInput input, RuleExecutionContext context);
}
```

Important design choices:

- input is DTO, not entity;
- context is platform-controlled;
- rule result is structured and auditable;
- no repository passed to plugin;
- no raw secret passed to plugin;
- no direct transaction boundary exposed.

### 28.4 Plugin Metadata

```properties
Bundle-SymbolicName: com.acme.rules.escalation.latefee
Bundle-Version: 2.1.0
Export-Package: 
Import-Package: \
  com.acme.enforcement.rule.spi;version="[2.0,3)",\
  com.acme.enforcement.rule.dto;version="[2.0,3)",\
  org.osgi.service.component.annotations;version="[1.4,2)"
Provide-Capability: \
  com.acme.enforcement.rule;\
    rule.id="latefee-escalation";\
    rule.type="escalation";\
    certification="2026-Q2";\
    risk="medium"
```

### 28.5 Admission Checks

```text
[ ] Bundle symbolic name matches approved namespace
[ ] Version is allowed
[ ] Signer is trusted
[ ] Checksum matches repository record
[ ] SBOM scan passed
[ ] Imports do not include forbidden packages
[ ] Exported packages are empty or approved
[ ] Capability metadata present
[ ] Certification exists
[ ] SPI version compatible
[ ] Component activates under test input
[ ] Health check passes
```

### 28.6 Execution Guard

```text
RuleExecutionManager:
  - selects approved rule only
  - records plugin identity
  - creates execution context
  - invokes with timeout
  - catches exception
  - emits audit event
  - increments per-plugin metrics
  - quarantines plugin on repeated failure
```

### 28.7 Audit Record

```json
{
  "event": "RULE_EVALUATED",
  "caseId": "CASE-123",
  "ruleId": "latefee-escalation",
  "bundleSymbolicName": "com.acme.rules.escalation.latefee",
  "bundleVersion": "2.1.0",
  "signer": "CN=Approved Plugin Signing",
  "result": "ESCALATE",
  "reasonCode": "LATE_FEE_THRESHOLD_EXCEEDED",
  "inputHash": "sha256:...",
  "durationMs": 37,
  "runtimeId": "prod-osgi-2",
  "timestamp": "2026-06-18T15:00:00Z"
}
```

This creates defensibility.

---

## 29. Anti-Patterns

### Anti-Pattern 1 — “OSGi Classloader Isolation Is Security”

Wrong.

Classloader isolation is a modularity tool. It reduces accidental access, but not enough for malicious code containment.

### Anti-Pattern 2 — Exporting Internal Security APIs

```properties
Export-Package: com.acme.security.*
```

This exposes too much.

### Anti-Pattern 3 — Service Ranking for Security-Sensitive Binding

```text
Highest ranking wins
```

This is dangerous for identity, secrets, audit, payment, authorization, and management services.

### Anti-Pattern 4 — Hot Deploy Folder Writable in Production

Convenient, but turns filesystem write into runtime code execution.

### Anti-Pattern 5 — AllPermission Everywhere

If every bundle has `AllPermission`, permission model is documentation theater.

### Anti-Pattern 6 — Raw Secrets in Config Admin

Config Admin is not a vault.

### Anti-Pattern 7 — Arbitrary Java Plugins From Customers in Same JVM

Especially invalid as strong sandbox claim on Java 24/25.

### Anti-Pattern 8 — Trusting Manifest Self-Claims

`Provide-Capability` is not proof. It is a claim.

### Anti-Pattern 9 — No Plugin Decision Audit

If plugin output affects regulated lifecycle, lack of audit is architecture failure.

### Anti-Pattern 10 — No Negative Security Tests

If you never test that unauthorized bundle cannot do X, you do not know if policy works.

---

## 30. Troubleshooting Security Failures

### 30.1 Bundle Cannot Get Service

Possible causes:

```text
- service not registered
- package import unresolved
- target filter mismatch
- permission denied
- classloader mismatch
- DS reference unsatisfied
- service registered under different interface
```

Debug:

```text
1. Check bundle state
2. Check service list
3. Check service properties
4. Check DS component state
5. Check import/export wiring
6. Check permission policy if active
7. Check logs for security exception
```

### 30.2 AccessControlException in Java 8 Runtime

Investigate:

```text
- exact permission denied
- call stack
- bundle location
- signer
- CPA policy order
- default permissions
- AllPermission assumptions
- library needing extra permission
```

Do not fix by blindly granting `AllPermission` unless you explicitly decide to abandon sandboxing.

### 30.3 Plugin Registered but Not Admitted

Check:

```text
- signer mismatch
- capability metadata missing
- forbidden import
- version incompatible
- certification expired
- health check failed
- config missing
- duplicate plugin ID
```

### 30.4 Security Bundle Stopped

This is a serious condition.

Design:

- kernel should fail closed;
- plugin execution should stop;
- admin alert emitted;
- audit record created;
- management operation restricted.

### 30.5 Unexpected Provider Bound

Check:

```text
- service ranking
- target filter
- duplicate provider
- registration order
- greedy reference policy
- config target changed
- service properties spoofed
```

For sensitive services, explicit binding is safer than ranking.

---

## 31. Security Testing Strategy

### 31.1 Static Tests

```text
[ ] Manifest exports only approved packages
[ ] No DynamicImport-Package unless explicitly approved
[ ] No Require-Bundle to kernel internal bundles
[ ] No forbidden imports
[ ] No embedded vulnerable libraries
[ ] Bundle-SymbolicName follows namespace policy
[ ] Bundle-Version valid
[ ] Provide-Capability metadata valid
```

### 31.2 Resolver Tests

```text
[ ] Plugin resolves only against approved APIs
[ ] Plugin cannot wire to internal package
[ ] Multiple plugin versions resolve as expected
[ ] Incompatible API version rejected
[ ] javax/jakarta mix rejected when unsafe
```

### 31.3 Runtime Admission Tests

```text
[ ] Unsigned plugin rejected
[ ] Wrong signer rejected
[ ] Unknown symbolic name rejected
[ ] Forbidden import rejected
[ ] Missing certification rejected
[ ] Duplicate plugin ID rejected
```

### 31.4 Negative Runtime Tests

```text
[ ] Plugin cannot get secret service
[ ] Plugin cannot register fake identity provider
[ ] Plugin cannot update sensitive PID
[ ] Plugin cannot trigger management operation
[ ] Plugin cannot execute rule after quarantine
[ ] Plugin cannot bypass authorization proxy
```

### 31.5 Resource Abuse Tests

```text
[ ] Infinite loop times out
[ ] High failure rate triggers circuit breaker
[ ] Event storm throttled
[ ] Memory-heavy plugin isolated or rejected
[ ] Slow activation detected
```

### 31.6 Audit Tests

```text
[ ] Rule execution records plugin identity
[ ] Config change records actor/source
[ ] Bundle install/update records signer/checksum
[ ] Rejected plugin admission is logged
[ ] Management command is audited
```

---

## 32. Production Readiness Checklist

```text
Architecture
[ ] Trust classes defined: internal, partner, semi-trusted, untrusted
[ ] Clear statement: same-JVM plugins are trusted/certified only
[ ] Untrusted code isolation strategy defined
[ ] API/SPI/internal package boundaries reviewed
[ ] Sensitive services not selected by ranking alone

Bundle Governance
[ ] Bundle signing policy defined
[ ] Repository trust chain defined
[ ] SBOM generated for bundles and embedded deps
[ ] Vulnerability scanning integrated
[ ] Baseline/version checks enabled
[ ] Forbidden import/export policy automated

Runtime Security
[ ] Remote shell disabled or hardened
[ ] Web console disabled or hardened
[ ] JMX restricted
[ ] Deploy folder not writable in production
[ ] Config Admin access controlled
[ ] Secrets stored as references, not plaintext

Plugin Admission
[ ] Signer validation
[ ] Symbolic name allowlist
[ ] Version compatibility check
[ ] Capability metadata validation
[ ] Certification validation
[ ] Health check before activation
[ ] Quarantine mechanism

Application Security
[ ] Domain services enforce user/system authorization
[ ] ExecutionContext cannot be forged
[ ] Plugin cannot access raw repository directly
[ ] Audit records plugin identity and version
[ ] Sensitive operations fail closed

Operations
[ ] Bundle install/update audited
[ ] Config changes audited
[ ] Plugin execution metrics collected
[ ] Per-plugin failure rate monitored
[ ] Incident response includes bundle disable/quarantine
[ ] Rollback plan tested
```

---

## 33. Decision Framework: Same JVM or Separate Process?

Use same-JVM OSGi plugin when:

```text
[ ] Plugin is internal or certified partner code
[ ] Plugin must be low-latency in-process
[ ] Plugin API is narrow and stable
[ ] Plugin cannot access raw secrets/data stores directly
[ ] Plugin admission and audit exist
[ ] Runtime team accepts shared failure domain
```

Use separate process/container when:

```text
[ ] Plugin is arbitrary third-party code
[ ] Plugin comes from customer marketplace
[ ] Strong tenant isolation is required
[ ] Network/filesystem must be strongly restricted
[ ] Resource limits must be enforceable
[ ] Failure must not endanger platform JVM
[ ] Legal/security claim requires real sandbox boundary
```

Use DSL/rule engine when:

```text
[ ] Users need business customization, not arbitrary programming
[ ] Rules must be explainable/auditable
[ ] Security risk of Java plugin is too high
[ ] Determinism matters
[ ] Non-engineers maintain rules
```

---

## 34. Compact Mental Models

### 34.1 Security Layers

```text
OSGi package visibility = who can see types
OSGi service registry = who can collaborate dynamically
OSGi permission model = who may perform framework/service/package actions
Bundle signing = who produced artifact and whether it changed
Repository governance = which artifacts may enter runtime
Application authz = which user/system may perform domain action
Container/process isolation = what code can do at OS/resource level
Audit = what you can prove later
```

### 34.2 Trust Rule

```text
Same JVM means shared fate.
Shared fate requires trust or very strong compensating controls.
```

### 34.3 Plugin Rule

```text
Install is not admission.
Admission is not activation.
Activation is not authorization.
Authorization is not audit.
```

### 34.4 Java 25 Rule

```text
Do not design new Java 25 systems around SecurityManager-based in-JVM sandboxing.
```

### 34.5 Service Rule

```text
For security-sensitive services, explicit trusted binding beats dynamic highest-rank binding.
```

---

## 35. What You Should Be Able to Do After This Part

Setelah part ini, kamu seharusnya bisa:

1. Menjelaskan perbedaan module boundary, trust boundary, permission boundary, dan process boundary.
2. Menjelaskan mengapa OSGi classloader isolation bukan otomatis sandbox keamanan.
3. Membaca risiko permission model OSGi di konteks Java 8 vs Java 25.
4. Memahami peran `AdminPermission`, `ServicePermission`, `PackagePermission`, dan `CapabilityPermission`.
5. Membedakan Permission Admin dan Conditional Permission Admin.
6. Mendesain plugin admission flow berbasis signer, metadata, capability, certification, dan audit.
7. Menentukan kapan plugin aman dijalankan same-JVM dan kapan harus dipisah process/container.
8. Mendesain service registry agar tidak mudah dispoof oleh provider berbahaya.
9. Membuat checklist production hardening untuk shell, web console, deploy folder, config, dan JMX.
10. Menyusun security testing strategy termasuk negative tests.

---

## 36. Referensi Utama

- OSGi Core Specification, Security Layer.
- OSGi Core Specification, Permission Admin Service.
- OSGi Core Specification, Conditional Permission Admin Service.
- OSGi Core Specification, Service Layer.
- OSGi Core Specification, Module Layer.
- OSGi Compendium Specification, Configuration Admin.
- Apache Felix documentation: Framework, Security, Gogo Shell, Web Console, FileInstall.
- Eclipse Equinox documentation: security, runtime, launcher, p2, extension registry.
- Apache Karaf documentation: shell, JAAS, features, deployment, security.
- OpenJDK JEP 411: Deprecate the Security Manager for Removal.
- Oracle JDK 25 Security Guide: Security Manager permanently disabled as of JDK 24.
- bnd/Bndtools documentation: manifest generation, baseline, resolver, repositories.

---

## 37. Ringkasan Akhir

OSGi security harus dipahami secara realistis. OSGi memberikan modularity, lifecycle control, service registry governance, package visibility, permission model, dan artifact identity. Tetapi OSGi bukan magic sandbox.

Pada Java 8, OSGi permission model dapat menjadi bagian dari sandbox jika Java Security Manager aktif dan policy benar-benar diuji. Pada Java 17+, model itu harus diperlakukan sebagai legacy/compatibility concern. Pada Java 24/25, desain baru harus mengandalkan boundary lain untuk untrusted code: process/container isolation, repository governance, signing, certification, least privilege service API, config/secret hardening, runtime audit, dan domain authorization.

Untuk platform plugin yang serius, pertanyaan utamanya bukan “apakah bundle bisa di-load?”. Pertanyaannya adalah:

```text
Siapa membuat bundle ini?
Apakah artifact ini dipercaya?
API apa yang boleh dipakai?
Service apa yang boleh didaftarkan?
Data apa yang boleh disentuh?
Apa yang terjadi kalau bundle gagal?
Bagaimana kita membuktikan keputusan runtime setelah kejadian?
```

Itulah perbedaan antara memakai OSGi sebagai plugin framework biasa dan memakai OSGi sebagai runtime platform yang defensible.

---

## 38. Status Series

```text
Part 18 dari 35 selesai.
Series belum selesai.
```

Part berikutnya:

```text
19-jpms-osgi-java-module-system-interop-java-9-to-25.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 17 — Messaging, Events, and Async Runtime: Event Admin, Push Streams, Reactive Bridges](./17-messaging-events-async-runtime-event-admin-push-streams-reactive-bridges.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: 19 — JPMS and OSGi: Java Module System Interop from Java 9 to 25](./19-jpms-osgi-java-module-system-interop-java-9-to-25.md)

</div>