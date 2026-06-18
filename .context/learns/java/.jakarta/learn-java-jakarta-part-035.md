# learn-java-jakarta-part-035.md

# Bagian 35 — Jakarta Deployment (`javax.enterprise.deploy` / `jakarta.enterprise.deploy-api`): Deployment SPI, Tooling Contract, TargetModuleID, ProgressObject, dan Relevansi Modern

> Target pembaca: Java engineer yang ingin memahami Jakarta Deployment bukan sebagai cara utama deploy aplikasi modern, tetapi sebagai **deployment tooling SPI klasik**: bagaimana deployment tool berbicara dengan Jakarta EE platform/server, bagaimana target/module/progress dimodelkan, kenapa API ini jarang dipakai application developer, dan bagaimana membandingkannya dengan deployment modern berbasis Docker/Kubernetes/CI/CD.
>
> Fokus bagian ini: Jakarta Deployment 1.7, statusnya yang legacy/stable, artifact `jakarta.enterprise.deploy:jakarta.enterprise.deploy-api`, package historis `javax.enterprise.deploy.*`, deployment roles, `DeploymentManager`, `Target`, `TargetModuleID`, `ProgressObject`, `DeploymentStatus`, `DeployableObject`, `DeploymentConfiguration`, deployment plan, distribute/start/stop/undeploy/redeploy lifecycle, connected vs disconnected mode, vendor-specific tooling, GlassFish/Payara/WebLogic style deployment APIs, and how classic deployment maps conceptually to modern cloud-native delivery.

---

## Daftar Isi

1. [Orientasi: Jakarta Deployment Itu Apa?](#1-orientasi-jakarta-deployment-itu-apa)
2. [Status Modern: Jakarta Deployment 1.7, Legacy SPI, dan Jakarta EE 11](#2-status-modern-jakarta-deployment-17-legacy-spi-dan-jakarta-ee-11)
3. [Mental Model: Deployment Tool ↔ DeploymentManager ↔ Target Server](#3-mental-model-deployment-tool--deploymentmanager--target-server)
4. [Jakarta Deployment vs Modern Deployment](#4-jakarta-deployment-vs-modern-deployment)
5. [Dependency dan Namespace: `jakarta.enterprise.deploy-api` tetapi Package `javax.enterprise.deploy`](#5-dependency-dan-namespace-jakartaenterprisedeploy-api-tetapi-package-javajenterprisedeploy)
6. [Peta API](#6-peta-api)
7. [Roles dalam Deployment: Developer, Assembler, Deployer, Administrator](#7-roles-dalam-deployment-developer-assembler-deployer-administrator)
8. [Deployable Unit: WAR, EJB-JAR, EAR, RAR, CAR](#8-deployable-unit-war-ejb-jar-ear-rar-car)
9. [`DeploymentFactory` dan `DeploymentFactoryManager`](#9-deploymentfactory-dan-deploymentfactorymanager)
10. [`DeploymentManager`: Core SPI](#10-deploymentmanager-core-spi)
11. [`Target`: Deployment Destination](#11-target-deployment-destination)
12. [`TargetModuleID`: Identitas Module yang Sudah Dideploy](#12-targetmoduleid-identitas-module-yang-sudah-dideploy)
13. [`ProgressObject`: Async Operation Handle](#13-progressobject-async-operation-handle)
14. [`DeploymentStatus`, `StateType`, `CommandType`, `ActionType`](#14-deploymentstatus-statetyp-commandtype-actiontype)
15. [Lifecycle Operasi: `distribute`, `start`, `stop`, `undeploy`, `redeploy`](#15-lifecycle-operasi-distribute-start-stop-undeploy-redeploy)
16. [Connected Mode vs Disconnected Mode](#16-connected-mode-vs-disconnected-mode)
17. [`DeployableObject`: Membaca Struktur Archive](#17-deployableobject-membaca-struktur-archive)
18. [`DeploymentConfiguration` dan `DConfigBean`](#18-deploymentconfiguration-dan-dconfigbean)
19. [Deployment Plan: Server-Specific Configuration](#19-deployment-plan-server-specific-configuration)
20. [ModuleType dan Deployment Targeting](#20-moduletype-dan-deployment-targeting)
21. [Status, Event, Listener, dan Polling](#21-status-event-listener-dan-polling)
22. [Vendor-Specific Reality](#22-vendor-specific-reality)
23. [Why Application Developers Rarely Use This API](#23-why-application-developers-rarely-use-this-api)
24. [Classic App Server Deployment Flow](#24-classic-app-server-deployment-flow)
25. [Modern CI/CD Equivalent](#25-modern-cicd-equivalent)
26. [Mapping ke Docker/Kubernetes](#26-mapping-ke-dockerkubernetes)
27. [Security: Credentials, Role Mapping, Target Access](#27-security-credentials-role-mapping-target-access)
28. [Deployment Metadata: Descriptors, Annotations, Role Mapping](#28-deployment-metadata-descriptors-annotations-role-mapping)
29. [Operational Concerns: Rollback, Redeploy, Drift, Audit](#29-operational-concerns-rollback-redeploy-drift-audit)
30. [Testing Deployment Tooling](#30-testing-deployment-tooling)
31. [Observability dan Runbook](#31-observability-dan-runbook)
32. [Migration dari Classic App Server Deploy ke Cloud-Native Deploy](#32-migration-dari-classic-app-server-deploy-ke-cloud-native-deploy)
33. [Production Failure Modes](#33-production-failure-modes)
34. [Best Practices dan Anti-Patterns](#34-best-practices-dan-anti-patterns)
35. [Checklist Review](#35-checklist-review)
36. [Case Study 1: IDE Plugin Deploy WAR ke App Server](#36-case-study-1-ide-plugin-deploy-war-ke-app-server)
37. [Case Study 2: Legacy Admin Tool Menggunakan DeploymentManager](#37-case-study-2-legacy-admin-tool-menggunakan-deploymentmanager)
38. [Case Study 3: Redeploy Gagal karena TargetModuleID Stale](#38-case-study-3-redeploy-gagal-karena-targetmoduleid-stale)
39. [Case Study 4: Migrasi EAR Deployment ke Container Image](#39-case-study-4-migrasi-ear-deployment-ke-container-image)
40. [Latihan Bertahap](#40-latihan-bertahap)
41. [Mini Project: Jakarta Deployment SPI Lab](#41-mini-project-jakarta-deployment-spi-lab)
42. [Referensi Resmi](#42-referensi-resmi)

---

# 1. Orientasi: Jakarta Deployment Itu Apa?

Jakarta Deployment adalah spesifikasi API untuk deployment tooling.

Tujuan historisnya:

```text
Any compliant deployment tool
  can deploy assembled Jakarta EE applications
  onto any compatible Jakarta EE platform
  through a standard deployment API.
```

Dengan kata lain, API ini bukan untuk business application sehari-hari.

Ia lebih ditujukan untuk:

- IDE integration;
- deployment tool;
- server administration tool;
- application server plugin;
- vendor tooling;
- installer/deployer automation era klasik;
- tool yang perlu deploy WAR/EAR/RAR ke server Jakarta EE.

## 1.1 Bukan API bisnis

Application code normal hampir tidak pernah import:

```java
javax.enterprise.deploy.spi.DeploymentManager
```

Karena deployment adalah concern di luar runtime business logic.

## 1.2 Problem yang diselesaikan

Sebelum cloud-native deployment, banyak enterprise app berjalan di shared application server:

```text
GlassFish / WebLogic / WebSphere / JBoss / Payara / Open Liberty / etc.
```

Deployment flow klasik:

```text
build EAR/WAR/RAR
  ↓
deployment tool connects to app server
  ↓
select target server/cluster
  ↓
distribute module
  ↓
start module
  ↓
monitor progress
```

Jakarta Deployment mencoba menstandarkan tool-server interaction tersebut.

## 1.3 Kenapa perlu dipahami hari ini?

Walaupun jarang dipakai dalam development modern, API ini mengajarkan mental model penting:

- deployable archive;
- deployment target;
- module identity;
- asynchronous deployment progress;
- deploy vs start;
- undeploy vs redeploy;
- server-specific deployment configuration;
- separation antara application artifact dan operational target;
- classic deployer role.

Ini membantu kamu membaca legacy tooling, app-server admin docs, dan memahami kenapa modern deployment tools mengganti banyak model ini dengan image registry, orchestrator, rollout, readiness probe, dan GitOps.

## 1.4 Prinsip utama

```text
Jakarta Deployment is a tooling SPI for classic Jakarta EE deployment,
not the normal deployment model for modern cloud-native applications.
```

---

# 2. Status Modern: Jakarta Deployment 1.7, Legacy SPI, dan Jakarta EE 11

Jakarta Deployment official page mencantumkan **Jakarta Deployment 1.7** sebagai first release for Jakarta EE 8.

Tidak seperti banyak spesifikasi Jakarta EE modern yang sudah berpindah ke package `jakarta.*`, API Deployment 1.7.2 masih memakai package historis:

```java
javax.enterprise.deploy.*
```

Walaupun artifact Maven-nya berada di group:

```text
jakarta.enterprise.deploy
```

## 2.1 Jakarta EE 11 context

Jakarta EE 11 release page mencantumkan spesifikasi platform seperti Activation, Batch, Connectors, Mail, Messaging, Enterprise Beans, Authentication, Data, Concurrency, Persistence, CDI, Pages, EL, WebSocket, Faces, Validation, Security, Servlet, Tags, Transactions, REST, JSON-P, JSON-B, Annotations, Interceptors, Dependency Injection, dan lainnya.

Jakarta Deployment tidak muncul sebagai salah satu spesifikasi utama Jakarta EE 11 di daftar release tersebut.

Namun Jakarta EE Platform specification tetap memiliki konsep deployment requirements, role mapping, deployment descriptors, dan deployment tools sebagai bagian dari platform behavior.

Jadi bedakan:

```text
Deployment as platform operational concept
  ≠
Jakarta Deployment API/SPI as actively-modernized application API.
```

## 2.2 Versi yang relevan

Versi API yang umum ditemui:

```xml
<dependency>
  <groupId>jakarta.enterprise.deploy</groupId>
  <artifactId>jakarta.enterprise.deploy-api</artifactId>
  <version>1.7.2</version>
</dependency>
```

Tetapi package Java-nya:

```java
javax.enterprise.deploy
```

## 2.3 Legacy but useful

Statusnya lebih tepat dipahami sebagai:

```text
legacy/stable deployment SPI, mostly relevant to tooling/vendor integration,
not a mainstream application development API.
```

## 2.4 Kenapa tetap dibahas?

Karena seri ini membahas Jakarta ecosystem secara luas.

Deployment adalah bagian dari mental model enterprise platform:

```text
artifact + metadata + target + runtime configuration + lifecycle operation
```

Konsep itu tetap ada walau modern tooling berubah.

---

# 3. Mental Model: Deployment Tool ↔ DeploymentManager ↔ Target Server

Mental model utama:

```text
Deployment Tool
  ↓ obtains vendor DeploymentManager
DeploymentManager
  ↓ knows server targets
Target[]
  ↓ distribute module archive
ProgressObject
  ↓ eventually TargetModuleID[]
TargetModuleID
  ↓ start/stop/redeploy/undeploy
```

## 3.1 Deployment tool

Tool yang melakukan operasi deploy.

Contoh:

- IDE plugin;
- admin console;
- CLI wrapper;
- legacy automation;
- vendor deployment client.

## 3.2 DeploymentManager

Interface utama untuk operasi deployment.

Ia menyediakan:

- list targets;
- list running/non-running modules;
- distribute;
- start;
- stop;
- undeploy;
- redeploy;
- deployment configuration;
- locale/config support;
- release connection.

## 3.3 Target

Representasi destination deployment.

Contoh konseptual:

```text
server1
cluster-prod-a
managed-server-2
node-group-x
```

## 3.4 TargetModuleID

Identitas module yang sudah didistribusikan/deployed pada target tertentu.

Ini digunakan untuk operasi lifecycle selanjutnya.

## 3.5 ProgressObject

Deployment operation bersifat asynchronous.

`ProgressObject` adalah handle untuk memonitor status operasi.

## 3.6 DeploymentStatus

Status operation:

```text
running / completed / failed / released
```

plus command/action information.

---

# 4. Jakarta Deployment vs Modern Deployment

## 4.1 Classic Jakarta Deployment

```text
WAR/EAR/RAR
  ↓
connect to application server
  ↓
distribute to target
  ↓
start module
  ↓
server manages runtime
```

## 4.2 Modern cloud-native deployment

```text
source code
  ↓
build artifact/container image
  ↓
push image registry
  ↓
Kubernetes Deployment/Helm/GitOps
  ↓
rolling update
  ↓
readiness/liveness probes
```

## 4.3 Differences

| Concern | Classic Jakarta Deployment | Modern Cloud-Native |
|---|---|---|
| Artifact | WAR/EAR/RAR | Container image |
| Runtime | Shared app server | Pod/container runtime |
| Target | App server/cluster target | Namespace/node/pod/deployment |
| Operation | distribute/start/stop/undeploy | apply/rollout/scale/delete |
| State | server deployment repository | image registry + cluster state |
| Config | deployment plan/server config | ConfigMap/Secret/env/volume |
| Health | server module state | readiness/liveness/startup probes |
| Rollout | vendor-specific redeploy | rolling/canary/blue-green/GitOps |
| Tooling | deployment API/admin tool | kubectl/Helm/Argo/CD pipeline |

## 4.4 Conceptual overlap

DeploymentManager `distribute` roughly maps to:

```text
make artifact available to runtime
```

Kubernetes `apply` roughly maps to:

```text
desired runtime state declaration
```

They are not the same, but both answer:

```text
How does application artifact become running service?
```

## 4.5 Top-tier takeaway

Deployment abstraction changes, but deployment problems remain:

- target selection;
- configuration;
- credentials;
- validation;
- progress tracking;
- rollback;
- versioning;
- observability;
- drift;
- audit.

---

# 5. Dependency dan Namespace: `jakarta.enterprise.deploy-api` tetapi Package `javax.enterprise.deploy`

This is unusual and important.

## 5.1 Maven artifact

```xml
<dependency>
  <groupId>jakarta.enterprise.deploy</groupId>
  <artifactId>jakarta.enterprise.deploy-api</artifactId>
  <version>1.7.2</version>
</dependency>
```

## 5.2 Java package

```java
javax.enterprise.deploy.spi.DeploymentManager
javax.enterprise.deploy.spi.Target
javax.enterprise.deploy.spi.TargetModuleID
javax.enterprise.deploy.spi.status.ProgressObject
```

## 5.3 Why?

Jakarta Deployment 1.7 was first released for Jakarta EE 8 era, before the full namespace migration to `jakarta.*` in Jakarta EE 9.

It has not been modernized like Servlet/JPA/CDI into `jakarta.enterprise.deploy.*` packages.

## 5.4 Migration caution

Do not assume every Jakarta-branded artifact uses `jakarta.*` package.

For this API:

```text
artifact name is Jakarta
package remains javax
```

## 5.5 Practical impact

If you see `javax.enterprise.deploy` in legacy tooling, it may still be Jakarta Deployment API 1.7.2.

Do not blindly rewrite it to `jakarta.enterprise.deploy` unless a compatible API exists in your target platform.

---

# 6. Peta API

Important packages:

```text
javax.enterprise.deploy.model
javax.enterprise.deploy.shared
javax.enterprise.deploy.spi
javax.enterprise.deploy.spi.exceptions
javax.enterprise.deploy.spi.factories
javax.enterprise.deploy.spi.status
```

## 6.1 `model`

Contains deployment model objects for reading deployable module metadata.

Important:

- `DeployableObject`;
- `DDBean`;
- `DDBeanRoot`.

## 6.2 `shared`

Shared enums/value types:

- `ModuleType`;
- `StateType`;
- `CommandType`;
- `ActionType`;
- `DConfigBeanVersionType`.

## 6.3 `spi`

Main service provider interfaces:

- `DeploymentManager`;
- `Target`;
- `TargetModuleID`;
- `DeploymentConfiguration`;
- `DConfigBean`;
- `DConfigBeanRoot`;
- `XpathEvent`;
- `XpathListener`.

## 6.4 `factories`

Factory SPI:

- `DeploymentFactory`;
- `DeploymentFactoryManager`.

## 6.5 `status`

Operation status:

- `ProgressObject`;
- `DeploymentStatus`;
- `ProgressEvent`;
- `ProgressListener`;
- `ClientConfiguration`.

## 6.6 `exceptions`

Deployment-specific exceptions:

- `DeploymentManagerCreationException`;
- `InvalidModuleException`;
- `TargetException`;
- `OperationUnsupportedException`;
- `ConfigurationException`;
- `BeanNotFoundException`.

---

# 7. Roles dalam Deployment: Developer, Assembler, Deployer, Administrator

Jakarta EE historically defines distinct roles.

## 7.1 Application Component Provider

Writes components:

- servlets;
- EJBs;
- JPA entities;
- REST resources;
- message-driven beans;
- etc.

## 7.2 Application Assembler

Assembles components into deployable application.

Example:

```text
WAR/EJB-JAR/RAR combined into EAR
```

## 7.3 Deployer

Maps application metadata to operational environment:

- security role mapping;
- resource references;
- environment entries;
- server-specific config;
- target selection.

## 7.4 System Administrator

Operates runtime infrastructure.

## 7.5 Modern equivalent

| Classic Role | Modern Equivalent |
|---|---|
| Component provider | Application developer |
| Assembler | Build pipeline / platform engineer |
| Deployer | DevOps/platform/release engineer |
| Administrator | SRE/platform operations |

## 7.6 Why roles matter

Jakarta Deployment API is oriented toward deployer/tooling role, not application runtime code.

---

# 8. Deployable Unit: WAR, EJB-JAR, EAR, RAR, CAR

Deployment API operates on Jakarta EE modules.

## 8.1 WAR

Web application archive.

Contains:

- Servlet;
- JSP/Pages;
- REST resources;
- CDI beans;
- web resources;
- WEB-INF.

## 8.2 EJB-JAR

Enterprise Beans archive.

## 8.3 EAR

Enterprise application archive combining modules.

## 8.4 RAR

Resource adapter archive for Jakarta Connectors.

## 8.5 CAR

Application client archive.

## 8.6 ModuleType

Deployment API uses `ModuleType` to distinguish module kinds.

## 8.7 Modern context

In cloud-native Java, many apps are packaged as executable JAR or container image.

Deployment API's module taxonomy reflects classic Jakarta EE packaging.

---

# 9. `DeploymentFactory` dan `DeploymentFactoryManager`

A deployment tool needs to obtain a vendor-specific `DeploymentManager`.

## 9.1 DeploymentFactory

Factory implemented by vendor.

It knows how to connect to that vendor's platform.

## 9.2 DeploymentFactoryManager

Registry of deployment factories.

Conceptually:

```java
DeploymentFactoryManager manager = DeploymentFactoryManager.getInstance();
manager.registerDeploymentFactory(vendorFactory);
```

Then tool asks for manager by URI.

## 9.3 URI scheme

Each vendor can define deployment URI format.

Example conceptual:

```text
deployer:vendor://host:port/domain
```

Actual URI is vendor-specific.

## 9.4 Connected manager

Requires credentials/server connection.

## 9.5 Disconnected manager

Can support config/offline operations if vendor supports it.

## 9.6 Reality

Many modern app servers prefer their own CLI/REST/admin API instead of this generic SPI.

---

# 10. `DeploymentManager`: Core SPI

`DeploymentManager` provides the core set of functions a Jakarta EE platform must provide for application deployment in this SPI.

Important methods:

```java
Target[] getTargets()
TargetModuleID[] getRunningModules(ModuleType type, Target[] targets)
TargetModuleID[] getNonRunningModules(ModuleType type, Target[] targets)
TargetModuleID[] getAvailableModules(ModuleType type, Target[] targets)
DeploymentConfiguration createConfiguration(DeployableObject dObj)
ProgressObject distribute(Target[] targets, File archive, File plan)
ProgressObject start(TargetModuleID[] modules)
ProgressObject stop(TargetModuleID[] modules)
ProgressObject undeploy(TargetModuleID[] modules)
ProgressObject redeploy(TargetModuleID[] modules, File archive, File plan)
void release()
```

## 10.1 It is not a simple file copy API

`distribute` is more than copying archive.

It can include:

- validation;
- server-specific class generation;
- moving fully baked archive to targets;
- preparing deployment artifacts.

## 10.2 Start is separate

`distribute` can make module available.

`start` makes it running.

## 10.3 Stop is separate

`stop` stops running module but may leave it deployed/distributed.

## 10.4 Undeploy removes module

`undeploy` removes application from target server.

## 10.5 Redeploy optional

`isRedeploySupported()` tells whether vendor supports redeploy.

## 10.6 Release

`release()` tells deployment manager the tool no longer needs connection/resources.

## 10.7 Exceptions

Many methods can throw:

- invalid state;
- target exception;
- unsupported operation;
- invalid module.

---

# 11. `Target`: Deployment Destination

`Target` represents deployment destination.

## 11.1 Conceptual examples

```text
standalone-server
cluster-a
managed-server-1
node-group-prod
```

## 11.2 Methods

Typically:

```java
String getName()
String getDescription()
```

## 11.3 Target selection

Deployment tool may present target list to deployer.

## 11.4 Multi-target deploy

`distribute` can accept `Target[]`.

## 11.5 Modern equivalent

Kubernetes equivalents might be:

- namespace;
- cluster;
- deployment;
- node pool;
- environment.

Not one-to-one.

## 11.6 Failure mode

Target selected by name may not exist anymore.

Tool must refresh target list.

---

# 12. `TargetModuleID`: Identitas Module yang Sudah Dideploy

`TargetModuleID` identifies a deployed module on a target.

## 12.1 Why needed?

After deploy, later operations need precise module identity:

```text
start this module
stop this module
undeploy this module
redeploy this module
```

## 12.2 Contains

Conceptually:

- target;
- module ID;
- web URL if available;
- parent/child module relation.

## 12.3 EAR hierarchy

EAR may contain child modules:

```text
myapp.ear
  ├── web.war
  ├── service-ejb.jar
  └── connector.rar
```

`TargetModuleID` can represent hierarchy.

## 12.4 Staleness

If module is undeployed/redeployed, old `TargetModuleID` may become stale.

## 12.5 Modern equivalent

Kubernetes resources have UIDs/resource versions.

Similar problem:

```text
old identity may not represent current deployed object
```

## 12.6 Tooling rule

Always treat module IDs as runtime handles, not eternal names.

---

# 13. `ProgressObject`: Async Operation Handle

Deployment operations can take time.

`ProgressObject` represents operation progress.

## 13.1 Why async?

Deployment may involve:

- upload archive;
- validate descriptors;
- generate container classes;
- distribute to cluster nodes;
- start module;
- initialize resources;
- update registry.

## 13.2 Methods conceptually

```java
DeploymentStatus getDeploymentStatus()
TargetModuleID[] getResultTargetModuleIDs()
void addProgressListener(ProgressListener listener)
void removeProgressListener(ProgressListener listener)
boolean isCancelSupported()
void cancel()
boolean isStopSupported()
void stop()
```

## 13.3 Polling

Tool can poll `getDeploymentStatus()`.

## 13.4 Listener

Tool can subscribe to progress events.

## 13.5 Result modules

After successful distribute, result includes `TargetModuleID[]`.

## 13.6 Cancel/stop

Support optional.

## 13.7 Modern equivalent

Kubernetes:

```text
kubectl rollout status
watch deployment events
observe pod readiness
```

Same async operation idea.

---

# 14. `DeploymentStatus`, `StateType`, `CommandType`, `ActionType`

Deployment status has multiple dimensions.

## 14.1 StateType

Conceptually:

```text
RUNNING
COMPLETED
FAILED
RELEASED
```

## 14.2 CommandType

Which command is being performed:

```text
DISTRIBUTE
START
STOP
UNDEPLOY
REDEPLOY
```

## 14.3 ActionType

Which action phase:

```text
EXECUTE
CANCEL
STOP
```

## 14.4 Message

Status includes human-readable message.

## 14.5 Why structured status?

Deployment tool can show:

```text
Starting module X on target Y... completed.
```

or:

```text
Distribute failed: invalid deployment descriptor.
```

## 14.6 Failure detail

The API is limited; vendor-specific logs often required for root cause.

## 14.7 Tooling best practice

Always capture:

- command;
- action;
- state;
- status message;
- target;
- archive name;
- timestamp;
- vendor logs if possible.

---

# 15. Lifecycle Operasi: `distribute`, `start`, `stop`, `undeploy`, `redeploy`

## 15.1 Distribute

```text
artifact → target server repository/prepared state
```

May validate and generate server-specific artifacts.

## 15.2 Start

```text
deployed module → running module
```

## 15.3 Stop

```text
running module → stopped/non-running module
```

Still deployed.

## 15.4 Undeploy

```text
module removed from target
```

## 15.5 Redeploy

```text
replace deployed module with new archive/plan
```

Optional support.

## 15.6 Sequence example

```text
getTargets
  ↓
distribute(targets, app.war, plan.xml)
  ↓ wait ProgressObject completed
get TargetModuleID
  ↓
start(TargetModuleID[])
  ↓ wait completed
```

## 15.7 Failure recovery

If distribute succeeded but start failed, module may remain deployed but stopped.

Tool must handle partial state.

## 15.8 Modern equivalent

Kubernetes deployment also has partial states:

```text
new ReplicaSet created, pods crashloop, rollout not complete
```

---

# 16. Connected Mode vs Disconnected Mode

DeploymentManager can operate in connected or disconnected mode.

## 16.1 Connected mode

Tool is connected to running platform/server.

Can perform:

- get targets;
- get running modules;
- distribute;
- start/stop/undeploy.

## 16.2 Disconnected mode

Tool may work without live server.

Useful for offline configuration.

## 16.3 Limitations

Some methods throw `IllegalStateException` if called while disconnected.

Example: `getTargets()` requires connection.

## 16.4 Modern analogy

Disconnected mode resembles:

```text
render Kubernetes YAML without applying it
```

Connected mode resembles:

```text
kubectl apply to cluster
```

## 16.5 Practical issue

Not all vendors support rich disconnected mode.

---

# 17. `DeployableObject`: Membaca Struktur Archive

`DeployableObject` represents deployable module metadata.

## 17.1 Purpose

Deployment tools may need to inspect deployment descriptors and module structure.

## 17.2 Examples

- read web.xml;
- read ejb-jar.xml;
- inspect resource references;
- inspect security roles;
- inspect module type;
- create server-specific configuration beans.

## 17.3 DDBean

`DDBean` represents deployment descriptor elements.

## 17.4 DDBeanRoot

Root descriptor bean.

## 17.5 Descriptor era

This API reflects deployment descriptor-heavy Java EE era.

Modern Jakarta apps use many annotations and external config.

## 17.6 Still relevant

Enterprise apps may still have descriptors:

```text
web.xml
ejb-jar.xml
application.xml
ra.xml
application-client.xml
```

---

# 18. `DeploymentConfiguration` dan `DConfigBean`

Deployment configuration represents server-specific configuration for deployable object.

## 18.1 Why needed?

Standard deployment descriptors describe portable metadata.

But servers often need vendor-specific settings:

- JNDI names;
- resource mapping;
- security role mapping;
- cluster target;
- classloading;
- datasource binding;
- transaction settings;
- context root.

## 18.2 DeploymentConfiguration

Created from `DeploymentManager.createConfiguration(DeployableObject)`.

## 18.3 DConfigBean

Configuration bean associated with descriptor metadata.

## 18.4 Deployment plan

Configuration can be saved as deployment plan.

## 18.5 Vendor specificity

This part is inherently vendor-specific.

Portable app metadata meets server-specific operational mapping here.

## 18.6 Modern equivalent

- Helm values;
- Kustomize overlays;
- environment-specific config;
- ConfigMaps/Secrets;
- app server config CLI;
- Terraform module variables.

---

# 19. Deployment Plan: Server-Specific Configuration

Deployment operations often take:

```java
File moduleArchive
File deploymentPlan
```

## 19.1 Module archive

WAR/EAR/RAR/JAR.

## 19.2 Deployment plan

Server-specific config file.

## 19.3 Why separate?

Same app artifact can be deployed to different environments with different config.

```text
app.war + dev-plan.xml
app.war + prod-plan.xml
```

## 19.4 Benefits

- separate build artifact from environment config;
- avoid rebuilding for every target;
- explicit deployer mapping.

## 19.5 Risks

- plan drift;
- secret leakage;
- stale resource mapping;
- unversioned manual changes.

## 19.6 Modern equivalent

```text
container image + Helm values
container image + ConfigMap/Secret
immutable artifact + environment config
```

## 19.7 Best practice

Version deployment plans/configs.

Do not keep them only in admin console.

---

# 20. ModuleType dan Deployment Targeting

`ModuleType` identifies module type.

Examples:

```text
WAR
EJB
EAR
RAR
CAR
```

## 20.1 Query by module type

```java
getRunningModules(ModuleType.WAR, targets)
```

## 20.2 Distribute with module type

API includes distribute variants that accept module type and streams.

## 20.3 Why needed?

A stream may not have file extension or module type easily inferred.

## 20.4 Targeting

Targets specify where module is deployed.

## 20.5 Multi-target result

Distribute to multiple targets can return multiple TargetModuleIDs.

## 20.6 Failure handling

Partial target failure possible.

Tool should report per-target result.

---

# 21. Status, Event, Listener, dan Polling

Deployment operations are async and observable through `ProgressObject`.

## 21.1 Polling pattern

```java
ProgressObject progress = dm.distribute(targets, archive, plan);

while (!progress.getDeploymentStatus().isCompleted()
    && !progress.getDeploymentStatus().isFailed()) {
    Thread.sleep(1000);
}
```

Conceptual only; use robust timeout and interruption handling.

## 21.2 Listener pattern

```java
progress.addProgressListener(event -> {
    DeploymentStatus status = event.getDeploymentStatus();
    log.info("{} {} {}", status.getCommand(), status.getState(), status.getMessage());
});
```

## 21.3 Timeout

The API does not magically enforce your release timeout.

Deployment tool should define max wait.

## 21.4 Cancellation

Check:

```java
progress.isCancelSupported()
```

## 21.5 Stop operation

Check:

```java
progress.isStopSupported()
```

## 21.6 User experience

Deployment tool should display progress and failure details.

## 21.7 Audit

Store operation result.

---

# 22. Vendor-Specific Reality

The idea of a universal deployment API is attractive.

In reality, deployment is deeply vendor-specific.

## 22.1 Vendor differences

- target model;
- cluster model;
- deployment plan format;
- credentials;
- admin protocol;
- classloading settings;
- resource mapping;
- redeploy support;
- rollback support;
- log location.

## 22.2 Common vendor tools

Vendors usually provide:

- CLI;
- admin console;
- REST management API;
- Maven/Gradle plugin;
- IDE plugin;
- auto-deploy directory;
- domain config.

## 22.3 Deployment API limitations

Generic API cannot expose every advanced feature.

## 22.4 Tool design

If building real tooling, expect vendor adapter layer.

```text
standard deployment API where possible
vendor API where necessary
```

## 22.5 Modern lesson

This is one reason cloud-native ecosystem moved toward declarative orchestrator APIs.

---

# 23. Why Application Developers Rarely Use This API

## 23.1 Deployment is outside application runtime

Business code should not deploy itself.

## 23.2 Modern tools replaced it

Today, developers deploy through:

- Maven/Gradle plugins;
- Docker build/push;
- Kubernetes manifests;
- Helm charts;
- GitHub Actions/GitLab CI/Jenkins;
- Argo CD/Flux;
- Terraform;
- server-specific CLI.

## 23.3 Server-specific APIs won

Application servers expose richer vendor APIs.

## 23.4 Cloud-native packaging changed model

Instead of pushing WAR to running app server, many apps ship as:

```text
immutable container image
```

## 23.5 Still useful to know

You may encounter it in:

- IDE plugin internals;
- old admin tooling;
- WebLogic/GlassFish deployment docs;
- server integration tests;
- legacy automation;
- migration projects.

## 23.6 Mental model remains valuable

Artifact + target + lifecycle + progress is still universal.

---

# 24. Classic App Server Deployment Flow

## 24.1 Build

```text
mvn package → app.war/app.ear
```

## 24.2 Prepare deployment plan

```text
app-plan-dev.xml
app-plan-prod.xml
```

## 24.3 Connect

Deployment tool obtains `DeploymentManager`.

## 24.4 Select target

```java
Target[] targets = dm.getTargets();
```

## 24.5 Distribute

```java
ProgressObject p = dm.distribute(targets, archive, plan);
```

## 24.6 Wait

Observe `ProgressObject`.

## 24.7 Start

```java
dm.start(p.getResultTargetModuleIDs());
```

## 24.8 Verify

Check running modules and health endpoint manually/vendor-specific.

## 24.9 Rollback

Classic API does not define rich rollback semantics.

Vendor tooling may.

---

# 25. Modern CI/CD Equivalent

Modern flow:

```text
git commit
  ↓
CI build/test
  ↓
container image build
  ↓
scan/sign image
  ↓
push registry
  ↓
update deployment manifest
  ↓
GitOps/CI apply
  ↓
rollout status
  ↓
health/readiness metrics
```

## 25.1 Artifact

Classic:

```text
WAR/EAR
```

Modern:

```text
container image + SBOM + provenance
```

## 25.2 Target

Classic:

```text
app server target
```

Modern:

```text
cluster/namespace/workload
```

## 25.3 Progress

Classic:

```text
ProgressObject
```

Modern:

```text
rollout status/events/conditions
```

## 25.4 Config

Classic:

```text
deployment plan
```

Modern:

```text
Helm values/ConfigMap/Secret/environment
```

## 25.5 Health

Classic:

```text
module started
```

Modern:

```text
readiness/liveness/startup probes + SLOs
```

## 25.6 Security

Classic:

```text
deployer credentials to app server
```

Modern:

```text
CI/CD identity, registry credentials, cluster RBAC, signing
```

---

# 26. Mapping ke Docker/Kubernetes

## 26.1 DeploymentManager equivalent?

Not one-to-one.

Closest conceptual equivalent:

```text
Kubernetes API server + kubectl/client-go
```

## 26.2 Target equivalent

Classic target:

```text
server/cluster target
```

Kubernetes:

```text
cluster + namespace + workload selector
```

## 26.3 TargetModuleID equivalent

Classic module handle.

Kubernetes:

```text
Deployment/ReplicaSet/Pod UID/resourceVersion
```

## 26.4 ProgressObject equivalent

Kubernetes:

```text
watch events
rollout status
Deployment conditions
Pod readiness
```

## 26.5 Deployment plan equivalent

```text
Helm values / Kustomize overlays / manifests
```

## 26.6 Start/stop equivalent

Classic:

```text
start/stop module
```

Kubernetes:

```text
scale replicas up/down
rollout restart
suspend/resume job
```

## 26.7 Undeploy equivalent

```text
kubectl delete deployment/service/config
```

## 26.8 Redeploy equivalent

```text
new image tag → rollout
```

---

# 27. Security: Credentials, Role Mapping, Target Access

Deployment is privileged.

## 27.1 Deployer credentials

Deployment tool needs credentials to target server.

Risk:

- leaked admin password;
- overly broad deployer permission;
- credential reuse;
- audit gap.

## 27.2 Least privilege

Deployer identity should only deploy specific apps/environments.

## 27.3 Secure storage

Do not hardcode credentials in scripts/deployment plans.

Use secret manager.

## 27.4 Role mapping

Jakarta EE platform requires ability to map app security roles to operational principals/groups.

## 27.5 Deployment plan secrets

Deployment plan may contain resource names or credentials depending vendor.

Protect it.

## 27.6 Audit

Record:

- who deployed;
- what artifact;
- target;
- config/plan;
- timestamp;
- result;
- rollback/failure.

## 27.7 Modern equivalent

Kubernetes:

- RBAC;
- service accounts;
- admission control;
- image signing;
- audit logs;
- secret management.

---

# 28. Deployment Metadata: Descriptors, Annotations, Role Mapping

Deployment is not only copying bytes.

## 28.1 Metadata sources

- annotations;
- deployment descriptors;
- vendor descriptors;
- deployment plan;
- server config.

## 28.2 Security roles

Application declares roles.

Deployer maps them to actual users/groups.

## 28.3 Resource references

App declares resource references.

Deployer maps to real resources.

Example:

```text
jdbc/MyDataSource → actual server datasource
```

## 28.4 Environment entries

Deploy-time config values.

## 28.5 Context root

WAR context path may be configured at deploy time.

## 28.6 Classic strength

Separation of portable app from operational environment.

## 28.7 Classic weakness

Config often hidden in server admin console and drifts from source control.

---

# 29. Operational Concerns: Rollback, Redeploy, Drift, Audit

## 29.1 Rollback

Jakarta Deployment API does not define modern rollout/rollback model.

Vendor tooling may provide.

## 29.2 Redeploy risk

Redeploy can:

- interrupt requests;
- leak classloaders if app not cleaned;
- leave stale resources;
- fail halfway.

## 29.3 Drift

Manual server config may drift from source control.

## 29.4 Audit

Need deployment log.

## 29.5 Artifact immutability

Do not overwrite same artifact version.

## 29.6 Health verification

Start completed does not mean business health is OK.

Add health check.

## 29.7 Smoke test

After deploy:

- app responds;
- datasource works;
- migration applied;
- key endpoint healthy.

## 29.8 Modern best practice

Use immutable artifacts, versioned config, automated rollout, health gates, and rollback plan.

---

# 30. Testing Deployment Tooling

## 30.1 Unit test adapter

Mock `DeploymentManager`.

Test:

- target selection;
- progress handling;
- failure mapping;
- timeout;
- stale TargetModuleID.

## 30.2 Integration test server

Use real app server in test environment.

## 30.3 Deploy sample WAR

Test full flow:

```text
distribute → start → verify → stop → undeploy
```

## 30.4 Failure tests

- invalid archive;
- wrong target;
- wrong credentials;
- server down;
- start failure;
- timeout;
- redeploy unsupported.

## 30.5 Idempotency tests

What happens if deploy same artifact twice?

## 30.6 Audit tests

Ensure operation recorded.

## 30.7 Security tests

Credential redaction in logs.

---

# 31. Observability dan Runbook

## 31.1 Metrics

Track:

- deployment attempts;
- success/failure;
- duration;
- target;
- module type;
- failure reason;
- rollback count;
- redeploy count.

## 31.2 Logs

Log:

- artifact name/version/checksum;
- deployment plan version;
- target;
- command;
- progress state;
- final status;
- correlation ID.

## 31.3 Do not log

- passwords;
- tokens;
- full deployment descriptors with secrets;
- private keys.

## 31.4 Runbook questions

1. Which artifact was deployed?
2. Which target?
3. Which deployment plan?
4. Which operation failed?
5. Did distribute succeed?
6. Did start fail?
7. Is module partially deployed?
8. How to rollback?
9. Where are server logs?
10. Who approved deployment?

## 31.5 Health gate

Deployment completed should be followed by health verification.

---

# 32. Migration dari Classic App Server Deploy ke Cloud-Native Deploy

## 32.1 Starting point

Legacy:

```text
EAR deployed to shared app server cluster
```

## 32.2 Target architecture

Modern:

```text
service packaged as container image
  deployed to Kubernetes
```

## 32.3 Migration concerns

- split EAR modules?
- externalize config;
- replace server-managed resources;
- datasource config;
- JMS/Mail/JNDI;
- security realm;
- session clustering;
- transaction/resource adapters;
- logs/metrics;
- health endpoints.

## 32.4 Deployment plan mapping

Vendor deployment plan values become:

- env vars;
- ConfigMaps;
- Secrets;
- Helm values;
- app config files.

## 32.5 Target mapping

App server targets become:

- namespace;
- deployment;
- service;
- ingress;
- node affinity;
- environment.

## 32.6 Rollout

Use:

- rolling update;
- canary;
- blue-green;
- feature flags.

## 32.7 Avoid big bang

Wrap legacy deploy first, then modernize gradually.

---

# 33. Production Failure Modes

## 33.1 DeploymentManager creation fails

Causes:

- wrong URI;
- missing vendor factory;
- wrong credentials;
- server unreachable;
- incompatible client/server version.

## 33.2 Target not found

Target list changed.

## 33.3 Distribute fails

Causes:

- invalid archive;
- invalid descriptor;
- missing deployment plan;
- server-specific validation failure;
- resource mapping missing.

## 33.4 Start fails after distribute succeeds

Module deployed but not running.

Need cleanup or fix config then start.

## 33.5 Redeploy unsupported

`isRedeploySupported()` false.

Tool must undeploy/deploy sequence or vendor command.

## 33.6 ProgressObject stuck

Operation never completes due server issue.

Tool needs timeout.

## 33.7 Partial multi-target deployment

Some targets succeed, others fail.

Need per-target reporting.

## 33.8 Stale TargetModuleID

Module was redeployed/undeployed externally.

Refresh state.

## 33.9 Deployment plan drift

Server config differs from versioned plan.

## 33.10 Credentials leaked

Bad logging or script storage.

## 33.11 Classloader leak after redeploy

Classic app server issue if app/resources not cleaned.

## 33.12 Health false positive

Deployment operation completed but app endpoint unhealthy.

---

# 34. Best Practices dan Anti-Patterns

## 34.1 Best practices

- Treat Jakarta Deployment as tooling SPI, not app runtime API.
- Prefer vendor-supported deployment tooling for real operations.
- Version deployment artifacts and plans.
- Capture artifact checksum.
- Use least privilege deployer credentials.
- Always monitor ProgressObject with timeout.
- Handle partial states.
- Verify health after start.
- Keep server config source-controlled where possible.
- Avoid manual admin-console drift.
- Plan rollback explicitly.
- For modern apps, prefer containerized/GitOps deployment.

## 34.2 Anti-pattern: app deploys itself

Business app should not call deployment manager to modify runtime.

## 34.3 Anti-pattern: no timeout waiting progress

Can hang deployment pipeline.

## 34.4 Anti-pattern: overwrite artifact version

Breaks rollback/audit.

## 34.5 Anti-pattern: credentials in deployment plan

Use secret management.

## 34.6 Anti-pattern: ignore partial deployment

Multi-target failure must be explicit.

## 34.7 Anti-pattern: assume start means healthy

Need health/smoke test.

## 34.8 Anti-pattern: blindly search-replace `javax.enterprise.deploy` to `jakarta.enterprise.deploy`

The stable API package is still `javax.enterprise.deploy`.

---

# 35. Checklist Review

## 35.1 API/tooling

- [ ] Do you actually need Jakarta Deployment API?
- [ ] Is vendor DeploymentFactory available?
- [ ] Is package namespace understood as `javax.enterprise.deploy`?
- [ ] Is deployment URI correct?
- [ ] Are connected/disconnected modes handled?
- [ ] Is vendor-specific behavior isolated?

## 35.2 Operation handling

- [ ] ProgressObject monitored?
- [ ] Timeout implemented?
- [ ] Listener/polling robust?
- [ ] Cancel/stop support checked?
- [ ] Partial target failures handled?
- [ ] Stale TargetModuleID handled?

## 35.3 Artifact/config

- [ ] Artifact version immutable?
- [ ] Checksum recorded?
- [ ] Deployment plan versioned?
- [ ] Resource mapping validated?
- [ ] Security role mapping validated?
- [ ] Secrets protected?

## 35.4 Security

- [ ] Least privilege deployer account?
- [ ] Credentials not logged?
- [ ] Audit trail recorded?
- [ ] Target access controlled?
- [ ] Deployment plan protected?

## 35.5 Modernization

- [ ] Does this need migration to CI/CD/Kubernetes?
- [ ] Is config externalized?
- [ ] Is health check defined?
- [ ] Is rollback strategy defined?
- [ ] Is drift monitored?

---

# 36. Case Study 1: IDE Plugin Deploy WAR ke App Server

## 36.1 Scenario

IDE wants to deploy `app.war` to local Jakarta EE server.

## 36.2 Flow

```text
IDE plugin
  ↓ register vendor DeploymentFactory
  ↓ get DeploymentManager
  ↓ getTargets
  ↓ distribute app.war
  ↓ wait ProgressObject
  ↓ start TargetModuleID
  ↓ open browser at module URL
```

## 36.3 Failure handling

If distribute fails, show server message and logs.

If start fails, show partial deployed state.

## 36.4 Why API fits

IDE plugin is exactly the kind of tool this API targeted.

## 36.5 Modern replacement

IDE may instead run:

- server-specific deploy command;
- Docker Compose;
- Kubernetes dev tool;
- Maven plugin.

---

# 37. Case Study 2: Legacy Admin Tool Menggunakan DeploymentManager

## 37.1 Scenario

Company has internal Swing/CLI deployer from Java EE era.

It uses `DeploymentManager` to deploy EARs to WebLogic/GlassFish-like server.

## 37.2 Problem

After server upgrade, DeploymentFactory URI no longer works.

## 37.3 Investigation

Check:

- vendor deployment client version;
- server admin protocol;
- credentials;
- API compatibility;
- target names;
- deployment plan format;
- logs.

## 37.4 Fix options

- update vendor client libraries;
- switch to vendor CLI/REST API;
- wrap modern CI/CD pipeline;
- retire generic Deployment API usage.

## 37.5 Lesson

Deployment SPI portability was limited by vendor reality.

---

# 38. Case Study 3: Redeploy Gagal karena TargetModuleID Stale

## 38.1 Scenario

Tool caches `TargetModuleID` from previous deployment.

Another admin undeploys/redeploys app from console.

Tool later calls:

```java
redeploy(oldTargetModuleID, newArchive, plan)
```

## 38.2 Problem

Redeploy fails because ID is stale.

## 38.3 Fix

Before lifecycle operation:

```text
refresh running/available modules
match by module ID/name/target
obtain current TargetModuleID
```

## 38.4 Lesson

Runtime handles are not durable truth.

Use refresh/reconciliation.

## 38.5 Modern analogy

Kubernetes resourceVersion/UID can become stale too.

Controllers reconcile desired/current state.

---

# 39. Case Study 4: Migrasi EAR Deployment ke Container Image

## 39.1 Starting point

Legacy app:

```text
monolithic app.ear
  deployed to shared app server cluster
  with deployment plan per environment
```

## 39.2 Target

```text
container image
  running on Kubernetes
```

## 39.3 Mapping

| Legacy | Modern |
|---|---|
| EAR | container image / multiple services |
| deployment plan | Helm values/ConfigMap/Secret |
| app server target | namespace/workload |
| JNDI datasource | app config + platform secret |
| server logs | stdout/central logging |
| server health | readiness/liveness probe |
| redeploy | rollout new image |

## 39.4 Risks

- hidden server config;
- JNDI dependencies;
- shared classloader assumptions;
- session replication;
- EJB remote calls;
- JMS/resource adapters;
- transaction semantics.

## 39.5 Strategy

1. Inventory deployment descriptors and server config.
2. Extract external config.
3. Add health endpoints.
4. Containerize with same app server if needed.
5. Move to Kubernetes gradually.
6. Replace server-specific deployment plan with GitOps config.

## 39.6 Lesson

Deployment modernization is architecture migration, not just packaging change.

---

# 40. Latihan Bertahap

## Latihan 1 — Read API docs

Identify key interfaces:

```text
DeploymentManager
Target
TargetModuleID
ProgressObject
```

## Latihan 2 — Model fake deployment

Create mock DeploymentManager that simulates distribute/start/stop.

## Latihan 3 — ProgressObject simulation

Implement fake progress with states:

```text
RUNNING → COMPLETED
RUNNING → FAILED
```

## Latihan 4 — Timeout handling

Write code that waits for progress with timeout.

## Latihan 5 — Target selection

Simulate multi-target deployment and partial failure.

## Latihan 6 — Stale TargetModuleID

Simulate cached ID becoming invalid.

## Latihan 7 — Deployment plan diff

Compare dev/prod deployment plans.

## Latihan 8 — Map to Kubernetes

Map `distribute/start/stop/undeploy` to Kubernetes concepts.

## Latihan 9 — Security audit

Design deployer credential storage and audit event.

## Latihan 10 — Migration plan

Take a legacy WAR/EAR deploy flow and design cloud-native equivalent.

---

# 41. Mini Project: Jakarta Deployment SPI Lab

## 41.1 Goal

Create:

```text
jakarta-deployment-spi-lab/
```

## 41.2 Modules

```text
fake-deployment-manager/
fake-targets/
progress-object/
status-listener/
deployment-plan/
partial-failure/
stale-target-module-id/
classic-to-kubernetes-mapping/
security-audit/
runbook/
```

## 41.3 Deliverables

```text
README.md
DEPLOYMENT-MENTAL-MODEL.md
DEPLOYMENTMANAGER.md
TARGET-AND-MODULE-ID.md
PROGRESSOBJECT.md
DEPLOYMENT-PLAN.md
VENDOR-SPECIFIC-REALITY.md
CLOUD-NATIVE-MAPPING.md
SECURITY.md
FAILURE-MODES.md
```

## 41.4 Required experiments

1. Simulate `distribute`.
2. Simulate `start`.
3. Simulate `stop`.
4. Simulate `undeploy`.
5. Track ProgressObject status.
6. Handle failure and timeout.
7. Model target/module hierarchy.
8. Model deployment plan.
9. Audit deployment event.
10. Map to Kubernetes rollout.

## 41.5 Evaluation questions

1. What is Jakarta Deployment API for?
2. Why is it mostly tooling-level?
3. What is `DeploymentManager`?
4. What is `Target`?
5. What is `TargetModuleID`?
6. Why is `ProgressObject` needed?
7. Difference distribute and start?
8. Why is redeploy optional?
9. Why does package remain `javax.enterprise.deploy`?
10. How does this differ from Kubernetes deployment?

---

# 42. Referensi Resmi

Referensi utama:

1. Jakarta Deployment specification overview  
   https://jakarta.ee/specifications/deployment/

2. Jakarta Deployment 1.7 API Docs  
   https://jakarta.ee/specifications/deployment/1.7/apidocs/

3. Jakarta EE 8 API Docs — `DeploymentManager`  
   https://jakarta.ee/specifications/platform/8/apidocs/javax/enterprise/deploy/spi/deploymentmanager

4. Jakarta Deployment API Maven artifact  
   https://central.sonatype.com/artifact/jakarta.enterprise.deploy/jakarta.enterprise.deploy-api/1.7.2/jar

5. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

6. Jakarta EE Platform 11 Specification  
   https://jakarta.ee/specifications/platform/11/jakarta-platform-spec-11.0.pdf

7. Jakarta Connectors 2.1  
   https://jakarta.ee/specifications/connectors/2.1/

8. Jakarta Enterprise Beans 4.0  
   https://jakarta.ee/specifications/enterprise-beans/4.0/

9. Jakarta Servlet 6.1  
   https://jakarta.ee/specifications/servlet/6.1/

10. Jakarta EE Platform Project  
    https://jakartaee.github.io/platform/

---

# Penutup

Jakarta Deployment adalah SPI deployment klasik untuk tooling.

Mental model ringkas:

```text
DeploymentFactory
  ↓ creates
DeploymentManager
  ↓ lists
Target[]
  ↓ distribute archive + plan
ProgressObject
  ↓ returns
TargetModuleID[]
  ↓ start/stop/redeploy/undeploy
```

Konteks modern penting:

```text
Jakarta Deployment official spec page currently centers on Jakarta Deployment 1.7,
first release for Jakarta EE 8.
The API artifact is jakarta.enterprise.deploy-api,
but Java packages remain javax.enterprise.deploy.*.
It is not a mainstream Jakarta EE 11 application API.
```

Prinsip paling penting:

```text
Deployment is a tooling/platform concern.
Application code should not manage deployment lifecycle of itself.
```

Engineer top-tier memahami bahwa deployment bukan hanya “copy WAR”. Ia melibatkan artifact, target, configuration plan, security role/resource mapping, progress, partial failure, rollback, audit, drift, and health verification. Ia juga tahu kapan model klasik ini harus diganti dengan immutable image, orchestrator rollout, GitOps, and platform engineering workflow.

Bagian berikutnya akan membahas **Jakarta Management (`jakarta.management.j2ee`)**: JSR-77 management model, managed objects, server/module/resource monitoring, JMX relation, why it is legacy/tooling-oriented, and how modern observability differs from classic Jakarta Management.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-jakarta-part-034.md">⬅️ Bagian 34 — Jakarta Activation (`jakarta.activation`): MIME Type, `DataHandler`, `DataSource`, Binary Content, Mail/SOAP Attachments, dan Content Handling</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-java-jakarta-part-036.md">Bagian 36 — Jakarta Management (`javax.management.j2ee`): MEJB, JSR-77 Management Model, Managed Objects, JMX Bridge, dan Observability Legacy ➡️</a>
</div>
