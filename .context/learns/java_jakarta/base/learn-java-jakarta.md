# Roadmap Materi Advanced: Jakarta Package / Jakarta EE

## Bagian 0 — Jakarta Package: Big Picture, Sejarah, dan Mental Model

File: `learn-java-jakarta-part-000.md`

Fokus:

* apa itu Jakarta EE;
* bedanya Java SE, Java EE, Jakarta EE, MicroProfile, Spring, Quarkus, Jakarta runtimes;
* kenapa package berubah dari `javax.*` ke `jakarta.*`;
* kenapa perubahan ini bukan sekadar rename import;
* hubungan specification, API jar, implementation, TCK, compatible runtime;
* Jakarta EE 8, 9, 9.1, 10, 11, dan arah Jakarta EE 12;
* cara berpikir “spec-first” vs “framework-first”;
* apa yang distandardisasi dan apa yang tidak;
* mental model portable enterprise Java.

Output pemahaman:

* bisa menjelaskan kenapa `jakarta.*` ada;
* bisa membedakan API dependency vs runtime implementation;
* bisa membaca aplikasi Jakarta EE tanpa bingung “magic”-nya datang dari mana.

---

## Bagian 1 — Namespace `javax.*` ke `jakarta.*`: Migration Mental Model

File: `learn-java-jakarta-part-001.md`

Fokus:

* sejarah legal/trademark yang menyebabkan namespace change;
* apa yang berubah di Jakarta EE 9;
* package mana yang berubah dan mana yang tidak;
* kenapa **tidak boleh blind replace semua `javax` ke `jakarta`**;
* contoh package Java SE yang tetap `javax.*`: `javax.net`, `javax.crypto`, `javax.sql`, `javax.management`;
* classpath conflict;
* dependency conflict;
* transitive dependency trap;
* bytecode/library yang masih membawa `javax.*`;
* migration strategy dari Java EE 8 / Jakarta EE 8 ke Jakarta EE 10/11;
* impact ke Spring Boot 2 → 3;
* impact ke servlet container, JPA, Bean Validation, JAXB, JMS, Mail;
* dual-stack compatibility problem.

Output pemahaman:

* bisa membuat migration plan `javax → jakarta`;
* bisa membaca error seperti `ClassNotFoundException: javax.servlet...` atau `NoClassDefFoundError: jakarta...`;
* bisa membedakan compile issue, runtime issue, dan dependency graph issue.

---

## Bagian 2 — Jakarta EE Platform, Web Profile, Core Profile

File: `learn-java-jakarta-part-002.md`

Fokus:

* apa itu Platform specification;
* apa itu Profile;
* Jakarta EE Platform vs Web Profile vs Core Profile;
* kapan memilih Core Profile;
* kapan memilih Web Profile;
* kapan membutuhkan full Platform;
* hubungan profile dengan cloud-native/microservice runtime;
* minimum Java SE baseline;
* apa arti “compatible implementation”;
* cara membaca specification matrix;
* konsekuensi production dari memilih profile terlalu besar atau terlalu kecil.

Output pemahaman:

* bisa memilih profile yang tepat;
* bisa menghindari membawa full platform hanya untuk REST API sederhana;
* bisa menjelaskan dependency surface dan runtime surface.

---

## Bagian 3 — Dependency Management: API, Implementation, Runtime, BOM

File: `learn-java-jakarta-part-003.md`

Fokus:

* dependency `jakarta.*-api`;
* provided scope vs compile/runtime scope;
* kenapa API jar tidak cukup untuk menjalankan aplikasi;
* implementation disediakan oleh container;
* fat jar vs WAR/EAR;
* Maven/Gradle setup;
* Jakarta EE BOM;
* classpath/module path;
* dependency convergence;
* duplicate API jar issue;
* shading/relocation risk;
* version alignment;
* `jakarta.platform:jakarta.jakartaee-api`;
* `jakarta.platform:jakarta.jakartaee-web-api`;
* `jakarta.platform:jakarta.jakartaee-core-api`;
* testing dependency strategy.

Output pemahaman:

* bisa menyusun dependency Jakarta EE dengan benar;
* tidak mencampur API jar dan implementation sembarangan;
* tahu kapan `provided` benar dan kapan berbahaya.

---

## Bagian 4 — Runtime / Container Model

File: `learn-java-jakarta-part-004.md`

Fokus:

* apa itu Jakarta EE runtime;
* container-managed object;
* lifecycle;
* injection;
* transaction;
* security;
* resource lookup;
* thread management;
* request context;
* application deployment model;
* WAR, EAR, executable runtime, thin deployment;
* embedded vs external container;
* Open Liberty, WildFly, Payara, GlassFish, TomEE, dan runtime sejenis sebagai kategori implementasi;
* portability vs vendor extension;
* TCK dan compatible product;
* cloud-native runtime packaging.

Output pemahaman:

* bisa menjelaskan apa yang container lakukan untuk aplikasi;
* bisa membedakan behavior plain Java object vs container-managed component;
* bisa menilai vendor/runtime lock-in.

---

## Bagian 5 — `jakarta.annotation` dan Common Annotations

File: `learn-java-jakarta-part-005.md`

Fokus:

* `@PostConstruct`;
* `@PreDestroy`;
* resource/lifecycle annotation;
* kapan lifecycle callback dipanggil;
* urutan lifecycle;
* dependency injection vs lifecycle callback;
* failure saat initialization;
* cleanup resource;
* relation ke CDI/Spring lifecycle;
* migration dari `javax.annotation`;
* common bug: heavy startup logic di `@PostConstruct`;
* shutdown behavior di Kubernetes.

Output pemahaman:

* bisa memakai lifecycle annotation dengan benar;
* tidak menaruh logic berat atau blocking tanpa mempertimbangkan startup/readiness;
* paham cleanup saat shutdown.

---

## Bagian 6 — `jakarta.inject`: Dependency Injection Minimal

File: `learn-java-jakarta-part-006.md`

Fokus:

* `@Inject`;
* `@Named`;
* `Provider<T>`;
* qualifier;
* scope;
* constructor injection;
* field injection;
* setter injection;
* perbedaan `jakarta.inject` dengan CDI penuh;
* dependency ambiguity;
* circular dependency;
* testability;
* package-level design.

Output pemahaman:

* bisa memahami injection sebagai contract standar;
* tahu bedanya DI minimal dan CDI container;
* bisa membuat dependency graph yang jelas.

---

## Bagian 7 — CDI: `jakarta.enterprise.*`

File: `learn-java-jakarta-part-007.md`

Fokus:

* Contexts and Dependency Injection;
* bean discovery;
* CDI Lite vs CDI Full;
* scopes: request, application, session, dependent, conversation;
* qualifiers;
* alternatives;
* producers;
* disposers;
* interceptors;
* decorators;
* events;
* portable extensions;
* build-compatible extensions;
* injection resolution;
* proxy mechanism;
* normal scope proxy;
* lifecycle;
* CDI in Core Profile;
* CDI vs Spring DI.

Output pemahaman:

* bisa memahami CDI sebagai container programming model;
* bisa menjelaskan kenapa bean kadang proxy;
* bisa memakai qualifier, producer, event, interceptor dengan tepat.

---

## Bagian 8 — Interceptors dan Decorators

File: `learn-java-jakarta-part-008.md`

Fokus:

* `jakarta.interceptor`;
* interceptor binding;
* method interception;
* invocation context;
* ordering;
* transaction/security/logging/audit use case;
* decorator pattern di CDI;
* cross-cutting concern;
* proxy boundary;
* self-invocation problem;
* performance overhead;
* debugging stack trace;
* comparison dengan Spring AOP.

Output pemahaman:

* bisa membangun audit/security/metrics interceptor;
* paham batas interception;
* tidak salah mengasumsikan internal method call selalu di-intercept.

---

## Bagian 9 — Jakarta RESTful Web Services: `jakarta.ws.rs`

File: `learn-java-jakarta-part-009.md`

Fokus:

* resource class;
* `@Path`, `@GET`, `@POST`, `@PUT`, `@DELETE`;
* `@PathParam`, `@QueryParam`, `@HeaderParam`, `@BeanParam`;
* request/response model;
* content negotiation;
* providers;
* filters;
* interceptors;
* exception mapper;
* validation integration;
* async response;
* SSE;
* client API;
* multipart concern;
* error contract;
* idempotency;
* REST API design production-grade.

Output pemahaman:

* bisa membuat REST API berbasis Jakarta yang production-grade;
* tahu provider/filter/exception mapper pipeline;
* bisa merancang error contract dan observability.

---

## Bagian 10 — JSON Processing: `jakarta.json` / JSON-P

File: `learn-java-jakarta-part-010.md`

Fokus:

* JSON-P object model;
* streaming API;
* `JsonObject`, `JsonArray`, `JsonReader`, `JsonWriter`;
* streaming vs object model;
* memory/performance trade-off;
* JSON patch;
* JSON pointer;
* low-level JSON manipulation;
* kapan memilih JSON-P dibanding JSON-B/Jackson;
* large payload handling.

Output pemahaman:

* bisa memproses JSON secara rendah-level dan streaming;
* paham kapan JSON-P lebih tepat daripada data binding.

---

## Bagian 11 — JSON Binding: `jakarta.json.bind` / JSON-B

File: `learn-java-jakarta-part-011.md`

Fokus:

* JSON-B mapping;
* default binding rules;
* constructor/record support;
* date/time;
* naming strategy;
* adapters;
* serializers/deserializers;
* null handling;
* generics;
* immutable DTO;
* polymorphism concern;
* JSON-B vs Jackson;
* compatibility dengan Jakarta REST.

Output pemahaman:

* bisa memakai JSON-B sebagai binding standar Jakarta;
* tahu limit dan trade-off dibanding Jackson;
* bisa menjaga JSON contract tetap stabil.

---

## Bagian 12 — Jakarta Persistence: `jakarta.persistence` / JPA

File: `learn-java-jakarta-part-012.md`

Fokus:

* entity manager;
* persistence context;
* entity lifecycle;
* managed/detached/removed;
* dirty checking;
* flush;
* transaction boundary;
* JPQL;
* Criteria API;
* named query;
* mapping;
* relationship;
* lazy/eager;
* cascade;
* orphan removal;
* optimistic/pessimistic locking;
* versioning;
* converters;
* embeddables;
* inheritance;
* query performance;
* JPA vs Hibernate extension;
* domain model vs persistence model.

Output pemahaman:

* bisa memakai JPA bukan hanya CRUD;
* paham persistence context dan flush semantics;
* bisa menghindari N+1, lazy loading trap, dan transaction leak.

---

## Bagian 13 — Jakarta Data: Repository Abstraction Standar

File: `learn-java-jakarta-part-013.md`

Fokus:

* Jakarta Data sebagai specification baru di Jakarta EE 11;
* repository abstraction;
* query method;
* pagination/sorting;
* integration dengan persistence provider;
* perbedaan Jakarta Data vs Spring Data;
* kapan memakai repository abstraction;
* kapan query eksplisit lebih aman;
* domain repository vs data repository;
* portability concern;
* production trade-off.

Output pemahaman:

* bisa memahami Jakarta Data sebagai standar repository modern;
* tidak menyalahgunakan derived query untuk query kompleks;
* bisa membedakan domain repository dan persistence repository.

---

## Bagian 14 — Jakarta Transactions: `jakarta.transaction`

File: `learn-java-jakarta-part-014.md`

Fokus:

* JTA;
* `@Transactional`;
* transaction manager;
* propagation;
* rollback rules;
* resource enlistment;
* XA transaction;
* local vs distributed transaction;
* synchronization callback;
* timeout;
* heuristic failure;
* transaction boundary di REST/service/worker;
* outbox vs XA;
* comparison dengan Spring transaction.

Output pemahaman:

* bisa memilih local transaction, JTA, XA, atau outbox;
* paham biaya distributed transaction;
* tahu failure mode commit/rollback.

---

## Bagian 15 — Jakarta Validation: `jakarta.validation`

File: `learn-java-jakarta-part-015.md`

Fokus:

* Bean Validation;
* constraint annotation;
* built-in constraints;
* custom constraint;
* validation groups;
* cascaded validation;
* method validation;
* container element validation;
* message interpolation;
* integration dengan REST;
* domain validation vs input validation;
* anti-pattern: semua business rule dijadikan annotation;
* error response mapping.

Output pemahaman:

* bisa memisahkan input validation, domain invariant, dan persistence constraint;
* bisa membuat validation error yang stable untuk API;
* tahu kapan custom constraint tepat.

---

## Bagian 16 — Jakarta Security: `jakarta.security.enterprise`

File: `learn-java-jakarta-part-016.md`

Fokus:

* identity store;
* authentication mechanism;
* security context;
* role-based access;
* form/basic/custom auth;
* token/JWT integration pattern;
* relation dengan servlet security;
* Jakarta Security vs Spring Security;
* production concerns: session, CSRF, stateless API, audit;
* authorization policy design;
* security anti-pattern.

Output pemahaman:

* bisa memahami security stack Jakarta;
* tahu apa yang distandardisasi dan apa yang sering vendor-specific;
* bisa merancang authentication/authorization yang defensible.

---

## Bagian 17 — Jakarta Authentication dan Authorization

File: `learn-java-jakarta-part-017.md`

Fokus:

* Jakarta Authentication;
* Jakarta Authorization;
* JASPIC/JACC lineage;
* container authentication;
* authorization provider;
* role mapping;
* policy enforcement;
* method security;
* integration with enterprise identity;
* deployment descriptor vs annotation;
* modern relevance;
* comparison dengan OAuth/OIDC resource server.

Output pemahaman:

* tahu layer security historis dan modern;
* bisa memutuskan kapan memakai Jakarta Security, container security, atau framework security lain.

---

## Bagian 18 — Jakarta Servlet: `jakarta.servlet`

File: `learn-java-jakarta-part-018.md`

Fokus:

* servlet lifecycle;
* request/response;
* filters;
* listeners;
* session;
* async servlet;
* multipart;
* error handling;
* dispatching;
* servlet container threading model;
* blocking I/O;
* virtual thread support implications;
* servlet security;
* Jakarta REST di atas servlet;
* Spring MVC relation;
* Tomcat/Jetty/Undertow conceptual comparison.

Output pemahaman:

* bisa memahami fondasi web Java modern;
* tahu filter chain, thread model, dan lifecycle;
* bisa debug issue web container.

---

## Bagian 19 — Jakarta Pages, Expression Language, Tags

File: `learn-java-jakarta-part-019.md`

Fokus:

* Jakarta Server Pages;
* Jakarta Expression Language;
* Jakarta Standard Tag Library;
* view rendering;
* legacy enterprise UI;
* security risk: XSS, expression injection;
* migration dari JSP lama;
* kapan masih relevan;
* kapan diganti SPA/server-side template modern;
* compatibility dengan servlet/session.

Output pemahaman:

* bisa membaca dan memigrasikan aplikasi JSP/JSTL legacy;
* tahu risiko dan batasan UI server-side legacy.

---

## Bagian 20 — Jakarta Faces: `jakarta.faces`

File: `learn-java-jakarta-part-020.md`

Fokus:

* JSF/Jakarta Faces lifecycle;
* component tree;
* managed beans/CDI;
* navigation;
* validation/conversion;
* AJAX;
* view state;
* session scope;
* performance issue;
* security concern;
* legacy modernization;
* Jakarta Faces vs REST + SPA.

Output pemahaman:

* bisa memahami aplikasi Jakarta Faces/JSF;
* bisa memutuskan refactor, maintain, atau migrate.

---

## Bagian 21 — Jakarta WebSocket: `jakarta.websocket`

File: `learn-java-jakarta-part-021.md`

Fokus:

* endpoint;
* session;
* encoder/decoder;
* lifecycle;
* server endpoint;
* client endpoint;
* message types;
* error handling;
* concurrency;
* backpressure;
* scaling;
* sticky session;
* pub/sub fanout;
* security;
* observability.

Output pemahaman:

* bisa membangun WebSocket Jakarta yang tidak collapse saat load;
* paham stateful connection problem di cluster.

---

## Bagian 22 — Jakarta Messaging: `jakarta.jms`

File: `learn-java-jakarta-part-022.md`

Fokus:

* JMS model;
* queue/topic;
* producer/consumer;
* session;
* acknowledgment;
* transaction;
* durable subscription;
* message selector;
* redelivery;
* DLQ;
* message-driven beans;
* JMS vs Kafka/RabbitMQ;
* exactly-once myth;
* idempotency;
* enterprise integration pattern.

Output pemahaman:

* bisa memahami messaging standar Jakarta;
* tahu kapan JMS cocok dan kapan Kafka/event streaming lebih cocok;
* bisa merancang consumer aman terhadap duplicate/redelivery.

---

## Bagian 23 — Jakarta Enterprise Beans: `jakarta.ejb`

File: `learn-java-jakarta-part-023.md`

Fokus:

* EJB history;
* stateless/stateful/singleton session bean;
* message-driven bean;
* transaction management;
* security;
* timer service;
* concurrency;
* remote/local interface;
* modern relevance;
* EJB vs CDI;
* migration strategy dari EJB legacy;
* anti-pattern EJB-heavy architecture.

Output pemahaman:

* bisa membaca dan memodernisasi aplikasi EJB;
* tahu mana fitur EJB yang masih relevan dan mana yang sebaiknya diganti.

---

## Bagian 24 — Jakarta Concurrency: `jakarta.enterprise.concurrent`

File: `learn-java-jakarta-part-024.md`

Fokus:

* managed executor;
* managed scheduled executor;
* managed thread factory;
* context propagation;
* container-managed thread;
* kenapa tidak sembarang membuat thread di container;
* virtual thread support;
* cancellation;
* timeout;
* bulkhead;
* integration dengan CDI/security/transaction context;
* comparison dengan Java SE executor.

Output pemahaman:

* bisa memakai concurrency di Jakarta EE tanpa melanggar container rules;
* paham konteks apa yang harus dipropagasikan;
* bisa menghindari thread leak dan shutdown issue.

---

## Bagian 25 — Jakarta Batch: `jakarta.batch`

File: `learn-java-jakarta-part-025.md`

Fokus:

* batch job;
* step;
* chunk;
* batchlet;
* checkpoint;
* restartability;
* job repository;
* partitioning;
* listener;
* transaction;
* error handling;
* retry/skip;
* operational dashboard;
* comparison dengan Spring Batch;
* batch in Kubernetes;
* idempotency dan rerun.

Output pemahaman:

* bisa merancang batch job enterprise yang restartable dan auditable;
* tahu perbedaan batch, worker, scheduler, dan stream processor.

---

## Bagian 26 — Jakarta Mail dan Activation

File: `learn-java-jakarta-part-026.md`

Fokus:

* `jakarta.mail`;
* SMTP/IMAP/POP3;
* MIME message;
* attachment;
* encoding;
* TLS;
* authentication;
* retry;
* email template;
* delivery status;
* bounce handling;
* Jakarta Activation;
* migration dari JavaMail;
* security: header injection, attachment scanning, PII.

Output pemahaman:

* bisa membangun email integration enterprise yang aman dan observable;
* tahu MIME/encoding issue yang sering muncul.

---

## Bagian 27 — Jakarta XML Binding: `jakarta.xml.bind`

File: `learn-java-jakarta-part-027.md`

Fokus:

* JAXB;
* schema-first vs code-first;
* marshalling/unmarshalling;
* annotation mapping;
* namespace;
* XML schema;
* adapters;
* validation;
* large XML;
* security: XXE, entity expansion;
* migration dari JAXB di JDK 8 ke dependency eksplisit;
* XML contract compatibility.

Output pemahaman:

* bisa maintain/migrate XML integration enterprise;
* tahu security hardening XML parser/binder.

---

## Bagian 28 — Jakarta XML Web Services dan SOAP Legacy

File: `learn-java-jakarta-part-028.md`

Fokus:

* SOAP;
* WSDL;
* JAX-WS lineage;
* generated client/server;
* contract-first service;
* WS-Security basics;
* migration from old Java EE;
* Jakarta XML Web Services status/usage;
* modern alternatives;
* anti-corruption layer untuk SOAP integration.

Output pemahaman:

* bisa memahami dan memodernisasi SOAP integration legacy;
* tidak memaksakan REST jika partner contract masih SOAP.

---

## Bagian 29 — Jakarta Connectors: `jakarta.resource`

File: `learn-java-jakarta-part-029.md`

Fokus:

* Java Connector Architecture;
* resource adapter;
* connection management;
* transaction enlistment;
* security context;
* legacy EIS integration;
* inbound/outbound resource adapter;
* operational concerns;
* modern relevance;
* comparison dengan custom client/library.

Output pemahaman:

* bisa memahami integrasi enterprise legacy yang memakai connector;
* tahu kapan JCA masih masuk akal.

---

## Bagian 30 — Jakarta Authorization, Roles, Identity, Audit dalam Sistem Regulatori

File: `learn-java-jakarta-part-030.md`

Fokus:

* role vs permission vs policy;
* method-level access;
* resource-level access;
* contextual authorization;
* audit event;
* actor identity;
* delegation;
* service-to-service identity;
* regulatory defensibility;
* Jakarta Security/Auth integration;
* mapping ke domain command.

Output pemahaman:

* bisa merancang authorization bukan sekadar `hasRole`;
* bisa menghubungkan security decision dengan audit dan domain event.

---

## Bagian 31 — Jakarta EE Testing Strategy

File: `learn-java-jakarta-part-031.md`

Fokus:

* unit test domain tanpa container;
* integration test dengan CDI/JPA/REST;
* Arquillian lineage;
* Testcontainers;
* embedded container;
* compatible runtime test;
* contract test;
* TCK mental model;
* testing transaction;
* testing security;
* testing REST provider/filter;
* testing messaging/batch;
* performance test.

Output pemahaman:

* bisa membuat test strategy Jakarta EE yang realistis;
* tahu kapan butuh container dan kapan cukup plain unit test.

---

## Bagian 32 — Jakarta EE Observability

File: `learn-java-jakarta-part-032.md`

Fokus:

* logging;
* metrics;
* tracing;
* OpenTelemetry;
* Micrometer interoperability;
* JFR;
* servlet/JAX-RS filters;
* CDI interceptor for telemetry;
* transaction tracing;
* JMS tracing;
* batch metrics;
* thread/connection pool metrics;
* domain event audit;
* high-cardinality trap.

Output pemahaman:

* bisa membuat aplikasi Jakarta observable;
* tahu titik instrumentation di container-managed stack.

---

## Bagian 33 — Jakarta EE Security Hardening

File: `learn-java-jakarta-part-033.md`

Fokus:

* secure coding Jakarta;
* servlet security;
* REST input validation;
* XML security;
* JSON security;
* deserialization;
* CSRF/session;
* authentication mechanism;
* authorization;
* secrets;
* TLS;
* dependency scanning;
* container hardening;
* supply chain;
* ASVS mapping.

Output pemahaman:

* bisa melakukan security review aplikasi Jakarta;
* tahu attack surface setiap package.

---

## Bagian 34 — Performance Engineering Jakarta EE

File: `learn-java-jakarta-part-034.md`

Fokus:

* startup time;
* reflection/CDI scanning;
* injection/proxy overhead;
* JSON-B/JPA performance;
* transaction cost;
* connection pool;
* servlet threading;
* virtual thread;
* lazy loading;
* N+1;
* batch throughput;
* messaging throughput;
* GC/allocation;
* JFR profiling;
* runtime tuning.

Output pemahaman:

* bisa men-debug performance issue di aplikasi Jakarta EE;
* tahu layer mana yang harus diprofile.

---

## Bagian 35 — Jakarta EE di Kubernetes dan Cloud-Native Runtime

File: `learn-java-jakarta-part-035.md`

Fokus:

* packaging;
* WAR vs executable jar;
* runtime image;
* resource sizing;
* health/readiness/liveness;
* graceful shutdown;
* session/state;
* sticky session;
* horizontal scaling;
* config/secrets;
* service discovery;
* TLS;
* observability;
* memory/GC in container;
* runtime selection.

Output pemahaman:

* bisa menjalankan Jakarta EE secara cloud-native;
* tidak terjebak model application server lama yang tidak cocok dengan container.

---

## Bagian 36 — Jakarta EE vs Spring vs Quarkus vs Micronaut

File: `learn-java-jakarta-part-036.md`

Fokus:

* standar vs framework;
* programming model;
* DI model;
* REST model;
* persistence;
* transactions;
* security;
* testing;
* cloud-native;
* build-time augmentation;
* AOT/native image;
* portability;
* ecosystem;
* migration cost;
* decision matrix.

Output pemahaman:

* bisa memilih teknologi berdasarkan constraint, bukan fanboyisme;
* tahu kapan Jakarta EE langsung cukup, kapan Spring/Quarkus/Micronaut lebih cocok.

---

## Bagian 37 — Migration Playbook: Java EE / Spring Boot 2 ke Jakarta EE Modern

File: `learn-java-jakarta-part-037.md`

Fokus:

* migration inventory;
* dependency graph;
* source namespace;
* bytecode transformation;
* build plugin;
* runtime upgrade;
* servlet container upgrade;
* JPA/Hibernate migration;
* validation migration;
* security migration;
* XML/JAXB/JAX-WS migration;
* testing migration;
* rollout;
* rollback;
* compatibility test.

Output pemahaman:

* bisa memimpin migration project `javax → jakarta`;
* tahu failure mode yang sering terjadi;
* bisa membuat migration plan enterprise.

---

## Bagian 38 — Legacy Modernization Case Study: EJB/JSP/JPA ke REST/CDI/JPA/Outbox

File: `learn-java-jakarta-part-038.md`

Fokus:

* membaca aplikasi legacy;
* extracting domain model;
* replacing JSP/JSF gradually;
* EJB to CDI/application service;
* JPA entity cleanup;
* transaction boundary redesign;
* outbox introduction;
* strangler pattern;
* compatibility layer;
* test harness;
* migration release plan.

Output pemahaman:

* bisa memodernisasi sistem Java EE lama tanpa big bang rewrite;
* tahu cara menjaga behavior tetap sama.

---

## Bagian 39 — Jakarta EE Reference Architecture untuk Sistem Regulatori

File: `learn-java-jakarta-part-039.md`

Fokus:

* case management;
* lifecycle/state machine;
* command API;
* audit trail;
* authorization;
* JPA aggregate persistence;
* outbox event;
* query/read model;
* batch processing;
* notification/email;
* document/evidence integration;
* regulatory defensibility;
* observability;
* incident model.

Output pemahaman:

* bisa menerapkan Jakarta EE untuk domain kompleks seperti enforcement/lifecycle/case management;
* bisa menghubungkan package Jakarta dengan kebutuhan sistem regulatori nyata.

---

## Bagian 40 — Capstone: Build Jakarta EE Production System

File: `learn-java-jakarta-part-040.md`

Fokus:

* project end-to-end;
* REST API;
* CDI;
* JPA;
* JTA;
* Validation;
* Security;
* JSON-B/P;
* JMS/Kafka bridge atau messaging abstraction;
* Batch;
* Mail;
* Observability;
* Kubernetes deployment;
* Testcontainers;
* migration tests;
* performance tests;
* security review;
* ADR;
* runbook;
* production readiness review.

Output pemahaman:

* punya blueprint lengkap aplikasi Jakarta EE production-grade;
* bisa menjelaskan setiap keputusan arsitektur;
* siap masuk ke level design/review/migration/operation.

---

[1]: https://jakarta.ee/release/11/?utm_source=chatgpt.com "Java EE 11 | Download Compatible Products & ..."
[2]: https://jakarta.ee/specifications/platform/11/?utm_source=chatgpt.com "Jakarta EE Platform 11 | Jakarta EE | The Eclipse Foundation"
