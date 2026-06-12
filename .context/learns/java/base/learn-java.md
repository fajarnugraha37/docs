# Daftar Isi Master — Java hingga Versi 25 untuk Software Engineer Serius

## Bagian 0 — Orientasi: Cara Berpikir Seperti Java Engineer Kuat

### 0.1 Java bukan sekadar bahasa

* Java sebagai language
* Java sebagai platform
* Java sebagai runtime
* Java sebagai ecosystem
* Java sebagai operational substrate untuk enterprise system

### 0.2 Apa yang membedakan engineer Java biasa vs top-tier

* Bukan hanya tahu Spring Boot
* Paham object model
* Paham JVM execution
* Paham memory model
* Paham concurrency semantics
* Paham failure mode
* Paham profiling
* Paham cost of abstraction
* Paham migration, compatibility, observability, dan production behavior

### 0.3 Mental model utama Java

* Source code
* Compilation
* Class file
* Class loading
* Verification
* Interpretation
* JIT compilation
* Heap allocation
* Garbage collection
* Threads
* Safepoints
* Native boundary
* Observability

### 0.4 Java release model

* Feature release tiap 6 bulan
* LTS sebagai vendor support concept
* Preview feature
* Incubator module
* Experimental feature
* Deprecation
* Removal
* Migration strategy antar versi

OpenJDK menyatakan JDK project merilis feature release setiap 6 bulan dengan model time-based yang ketat. ([OpenJDK][3])

---

# Bagian 1 — Setup, Toolchain, dan Cara Kerja Build Java Modern

## 1.1 Memasang JDK dengan benar

* Oracle JDK
* OpenJDK
* Eclipse Temurin
* Amazon Corretto
* Azul Zulu
* GraalVM
* Perbedaan vendor distribution
* Licensing dan production concern

## 1.2 Struktur JDK

* `java`
* `javac`
* `jar`
* `javadoc`
* `jshell`
* `jlink`
* `jpackage`
* `jdeps`
* `jcmd`
* `jmap`
* `jstack`
* `jfr`
* `jstat`

Oracle JDK 25 documentation menyediakan dokumentasi API, guide, tool specifications, JShell, javadoc, packaging, language/library, security, HotSpot VM, GC tuning, troubleshooting, monitoring, dan JMX. ([Oracle Docs][4])

## 1.3 Build tools

* Maven mental model
* Gradle mental model
* Dependency graph
* Transitive dependency
* Dependency conflict
* BOM
* Reproducible build
* Annotation processing
* Multi-module project

## 1.4 Runtime configuration

* Classpath
* Module path
* JVM options
* System properties
* Environment variables
* Container-aware JVM settings

## 1.5 Java project layout

* Single module
* Multi-module
* Layered package
* Feature package
* Hexagonal package
* Modulith package
* Library vs application project

---

# Bagian 2 — Fondasi Bahasa Java: Dari Syntax ke Semantics

## 2.1 Program paling kecil

* Class
* Method
* `main`
* `public static void main`
* Instance main method di Java modern
* Compact source files di Java 25

Java 25 memfinalisasi **Compact Source Files and Instance Main Methods** melalui JEP 512. ([OpenJDK][2])

## 2.2 Lexical structure

* Token
* Identifier
* Keyword
* Literal
* Separator
* Operator
* Comment
* Unicode escape

## 2.3 Primitive types

* `byte`
* `short`
* `int`
* `long`
* `float`
* `double`
* `char`
* `boolean`
* Numeric promotion
* Overflow
* Signedness problem
* Floating point precision
* `strictfp` historical relevance

## 2.4 Reference types

* Class type
* Interface type
* Array type
* Type variable
* `null`
* Identity
* Equality
* Object header

## 2.5 Variables

* Local variable
* Instance field
* Static field
* Parameter
* Effectively final
* Definite assignment

## 2.6 Expressions

* Evaluation order
* Side effect
* Short-circuiting
* Assignment expression
* Method invocation expression
* Lambda expression
* Switch expression

## 2.7 Statements

* Block
* If
* Loop
* Switch
* Try
* Throw
* Return
* Synchronized
* Local class
* Pattern matching statement interaction

---

# Bagian 3 — Object Model: Bagian yang Sering Diremehkan

## 3.1 Class sebagai blueprint

* Field
* Method
* Constructor
* Initializer block
* Static initializer
* Nested class
* Inner class
* Anonymous class
* Local class

## 3.2 Object sebagai identity + state + behavior

* Identity
* Object reference
* Object lifecycle
* Reachability
* Escape
* Aliasing
* Mutability

## 3.3 Constructor deep dive

* Initialization order
* Field initialization
* Constructor chaining
* `super(...)`
* `this(...)`
* Invariant construction
* Leaking `this`
* Final field semantics
* Flexible constructor bodies Java 25

Java 25 memfinalisasi **Flexible Constructor Bodies** melalui JEP 513. ([OpenJDK][2])

## 3.4 Inheritance

* Subtyping
* Method overriding
* Dynamic dispatch
* Field hiding
* Constructor behavior
* Fragile base class problem
* Composition vs inheritance

## 3.5 Interface

* Abstract method
* Default method
* Static method
* Private method
* Sealed interface
* Multiple inheritance of behavior
* API evolution with default methods

## 3.6 `Object`

* `equals`
* `hashCode`
* `toString`
* `clone`
* `finalize` historical danger
* `getClass`
* Object monitor

## 3.7 Equality

* Identity equality
* Logical equality
* Value object equality
* Equality contract
* Hash-based collection failure modes

---

# Bagian 4 — Type System, Generics, dan API Design

## 4.1 Static typing mental model

* Compile-time type
* Runtime type
* Subtyping
* Assignment compatibility
* Cast
* Type inference

## 4.2 Generics

* Type parameter
* Generic class
* Generic method
* Bounded type parameter
* Wildcard
* Upper bound
* Lower bound
* Capture conversion

## 4.3 Type erasure

* Kenapa Java generics erased
* Bridge method
* Heap pollution
* Raw type
* Reifiable vs non-reifiable type
* Generic array problem

## 4.4 Variance

* Invariance
* Covariance
* Contravariance
* PECS: Producer Extends, Consumer Super
* API design dengan wildcard

## 4.5 Advanced generic design

* Self-referential generic
* Type token
* F-bounded polymorphism
* Fluent API
* Builder API
* Generic repository design
* Generic mapper design
* Generic event envelope

## 4.6 Java 25 dan masa depan type system

* Primitive types in patterns preview
* Valhalla direction
* Specialized generics direction
* Value object direction
* Nullness direction

Java 25 masih membawa **Primitive Types in Patterns, `instanceof`, and `switch`** sebagai preview feature. ([OpenJDK][2])

---

# Bagian 5 — Modern Java Language Features

## 5.1 `var`

* Local variable type inference
* Kapan membantu
* Kapan merusak readability
* API boundary rules

## 5.2 Switch expression

* Arrow syntax
* Yield
* Exhaustiveness
* Enum switch
* Sealed type switch
* Pattern switch

## 5.3 Pattern matching

* `instanceof`
* Switch pattern
* Guard
* Dominance
* Exhaustiveness
* Refactoring polymorphic branching

## 5.4 Records

* Data carrier
* Canonical constructor
* Compact constructor
* Validation
* Immutability illusion
* Serialization concern
* DTO vs domain object

## 5.5 Sealed classes

* Closed hierarchy
* Exhaustive modeling
* State machine modeling
* Error modeling
* Command/event modeling
* Regulatory lifecycle modeling

## 5.6 Text blocks

* SQL
* JSON
* XML
* Test fixture
* Indentation rules

## 5.7 Unnamed variables and patterns

* Intentional discard
* Pattern readability
* Avoiding accidental binding

JDK 25 includes JEP 456, **Unnamed Variables & Patterns**, integrated since JDK 21. ([OpenJDK][2])

## 5.8 Module import declarations

* Importing module exports
* Simplifying educational and scripting use case
* Interaction with JPMS
* Java 25 behavior

Java 25 includes **Module Import Declarations** through JEP 511. ([OpenJDK][2])

---

# Bagian 6 — Functional Programming di Java

## 6.1 Lambda

* Lambda as object?
* Capturing
* Effectively final
* Stateless lambda
* Stateful lambda
* Allocation behavior
* `invokedynamic`

## 6.2 Functional interfaces

* `Function`
* `Consumer`
* `Supplier`
* `Predicate`
* `UnaryOperator`
* `BinaryOperator`
* Custom functional interface

## 6.3 Method reference

* Static method reference
* Bound instance reference
* Unbound instance reference
* Constructor reference

## 6.4 Stream API

* Source
* Intermediate operation
* Terminal operation
* Lazy evaluation
* Pipeline fusion
* Short-circuiting
* Parallel stream
* Collector

## 6.5 Stream failure modes

* Side effect
* Shared mutable state
* Ordering cost
* Boxing overhead
* Parallel stream misuse
* Debuggability problem

## 6.6 Stream Gatherers

* Mental model
* Custom intermediate operation
* Stateful transformation
* Windowing
* Batching
* Production caution

JDK 25 includes **Stream Gatherers**, integrated in JDK 24. ([OpenJDK][2])

---

# Bagian 7 — Collections, Data Structures, dan Performance Semantics

## 7.1 Collection hierarchy

* `Iterable`
* `Collection`
* `List`
* `Set`
* `Queue`
* `Deque`
* `Map`

## 7.2 List

* `ArrayList`
* `LinkedList`
* `CopyOnWriteArrayList`
* Memory layout
* Random access
* Insert/delete cost

## 7.3 Set

* `HashSet`
* `LinkedHashSet`
* `TreeSet`
* EnumSet
* Identity-based set

## 7.4 Map

* `HashMap`
* `LinkedHashMap`
* `TreeMap`
* `ConcurrentHashMap`
* `WeakHashMap`
* `IdentityHashMap`
* `EnumMap`

## 7.5 HashMap deep dive

* Hashing
* Bucket
* Collision
* Tree bin
* Load factor
* Resize
* `equals/hashCode` bug pattern
* Hash flooding

## 7.6 Immutable collections

* `List.of`
* `Set.of`
* `Map.of`
* Defensive copy
* Shallow immutability
* Persistent collection alternatives

## 7.7 Algorithmic thinking

* Big-O
* Constant factor
* Cache locality
* Allocation cost
* Boxing cost
* Iterator cost

---

# Bagian 8 — Error Handling, Exceptions, dan Reliability

## 8.1 Throwable hierarchy

* `Throwable`
* `Error`
* `Exception`
* Checked exception
* Runtime exception

## 8.2 Checked exception philosophy

* Kapan bagus
* Kapan bocor abstraction
* API design
* Migration pain

## 8.3 Exception cost

* Stack trace allocation
* Control flow abuse
* Hot path concern
* Observability value

## 8.4 Error handling strategy

* Domain error
* Technical error
* Recoverable error
* Non-recoverable error
* Retryable error
* User-facing error
* Audit-relevant error

## 8.5 Resource management

* `try-with-resources`
* `AutoCloseable`
* Suppressed exception
* Cleanup ordering
* Failure during cleanup

## 8.6 Production-grade failure model

* Timeout
* Cancellation
* Interruption
* Backpressure
* Partial failure
* Poison message
* Idempotency
* Dead-letter behavior

---

# Bagian 9 — Java Memory Model dan Concurrency Fundamental

## 9.1 Process vs thread

* OS process
* Platform thread
* Virtual thread
* Scheduler
* Context switch
* Blocking vs parking

## 9.2 Java Memory Model

* Happens-before
* Visibility
* Atomicity
* Ordering
* Data race
* Safe publication
* Final field semantics

## 9.3 Synchronization

* `synchronized`
* Monitor
* Lock acquisition
* Reentrancy
* Wait/notify
* Lock contention
* Biased locking historical context
* Monitor inflation

## 9.4 `volatile`

* Visibility guarantee
* Ordering guarantee
* Not mutual exclusion
* Correct usage pattern
* Broken usage pattern

## 9.5 Atomic classes

* CAS
* ABA problem
* `AtomicInteger`
* `AtomicReference`
* `LongAdder`
* `VarHandle`

## 9.6 Locks

* `ReentrantLock`
* `ReadWriteLock`
* `StampedLock`
* Fairness
* Condition
* Lock striping

## 9.7 Executors

* Thread pool
* Queue
* Rejection policy
* Bounded vs unbounded
* ForkJoinPool
* CompletableFuture executor trap

## 9.8 CompletableFuture

* Composition
* Callback execution
* Error propagation
* Timeout
* Cancellation
* Thread starvation
* Structured alternative

## 9.9 Virtual threads

* Mental model
* Carrier thread
* Parking
* Blocking I/O
* Pinning
* Throughput vs latency
* When not to use virtual threads

JDK 24 integrated **Synchronize Virtual Threads without Pinning**, and this is part of the JDK 25 feature set since JDK 21. ([OpenJDK][2])

## 9.10 Structured concurrency

* Why unstructured concurrency fails
* Task scope
* Parent-child lifetime
* Failure propagation
* Cancellation propagation
* Preview status in Java 25

Java 25 includes **Structured Concurrency** as fifth preview. ([OpenJDK][2])

## 9.11 Scoped values

* Alternative to ThreadLocal
* Immutable contextual data
* Request context
* Security context
* Tracing context
* Virtual-thread-friendly design

Java 25 includes **Scoped Values** through JEP 506. ([OpenJDK][2])

---

# Bagian 10 — I/O, NIO, Networking, dan Data Transfer

## 10.1 Classic I/O

* `InputStream`
* `OutputStream`
* `Reader`
* `Writer`
* Blocking model
* Buffering

## 10.2 NIO

* `Path`
* `Files`
* `ByteBuffer`
* `Channel`
* Selector
* Direct buffer
* Memory-mapped file

## 10.3 File processing besar

* Streaming
* Chunking
* Charset decoding
* Backpressure
* Memory budget
* Zero-copy limitation
* Large file pitfalls

## 10.4 Networking

* Socket
* ServerSocket
* TLS
* DNS
* Timeout
* Keep-alive
* Connection pooling

## 10.5 HTTP Client

* Sync request
* Async request
* HTTP/2
* BodyPublisher
* BodySubscriber
* Timeout
* Redirect
* Proxy

## 10.6 Serialization

* Java serialization
* Why dangerous
* `Serializable`
* `Externalizable`
* JSON
* CBOR
* Protobuf
* Avro
* Schema evolution

## 10.7 Foreign Function & Memory API

* Native interop
* Memory segment
* Arena
* Linker
* Replacement direction for unsafe/native access

JDK 25 includes the **Foreign Function & Memory API**, integrated in JDK 22. ([OpenJDK][2])

---

# Bagian 11 — Text, Unicode, Locale, Date-Time

## 11.1 String mental model

* Immutability
* String pool
* Interning
* Compact strings
* Concatenation
* `StringBuilder`
* `StringBuffer`

## 11.2 Unicode

* Code unit
* Code point
* Grapheme cluster
* Surrogate pair
* Normalization
* Case folding
* Locale-sensitive comparison

## 11.3 Charset

* UTF-8
* UTF-16
* ISO-8859 family
* Charset decoder
* Malformed input
* Replacement character
* File boundary issue

## 11.4 Regex

* Pattern compilation
* Backtracking
* Catastrophic backtracking
* Unicode class
* Named group

## 11.5 Date-Time API

* `Instant`
* `LocalDate`
* `LocalDateTime`
* `ZonedDateTime`
* `OffsetDateTime`
* `Duration`
* `Period`
* Time zone database
* DST failure mode

## 11.6 Locale

* Formatting
* Collation
* Turkish-I problem
* Currency
* Number format
* Message format

---

# Bagian 12 — JVM Internal: Dari Class File sampai JIT

## 12.1 Compilation pipeline

* Java source
* AST
* Bytecode
* Class file
* Constant pool
* Verification

## 12.2 Class loading

* Bootstrap class loader
* Platform class loader
* Application class loader
* Custom class loader
* Delegation model
* Class identity problem

## 12.3 Bytecode

* Operand stack
* Local variable table
* Constant pool
* Method descriptor
* Field descriptor
* Invocation opcodes

## 12.4 Execution engine

* Interpreter
* Profiling
* Tiered compilation
* C1
* C2
* Deoptimization
* OSR

## 12.5 JIT optimization

* Inlining
* Escape analysis
* Scalar replacement
* Loop optimization
* Dead code elimination
* Lock elision
* Speculative optimization

## 12.6 Class-File API

* Why bytecode tools matter
* Instrumentation
* Agents
* Framework internals
* Safer class-file manipulation

JDK 25 includes **Class-File API**, integrated in JDK 24. ([OpenJDK][2])

## 12.7 Ahead-of-time direction

* AOT class loading and linking
* AOT method profiling
* Startup optimization
* CDS
* AppCDS
* Leyden direction

JDK 25 includes AOT-related JEPs such as **Ahead-of-Time Class Loading & Linking**, **Ahead-of-Time Command-Line Ergonomics**, and **Ahead-of-Time Method Profiling**. ([OpenJDK][2])

---

# Bagian 13 — Memory Management dan Garbage Collection

## 13.1 Heap

* Young generation
* Old generation
* Eden
* Survivor
* TLAB
* Humongous object
* Object alignment

## 13.2 Object layout

* Object header
* Mark word
* Class pointer
* Field layout
* Padding
* Compressed OOPs
* Compact object headers

Java 25 includes **Compact Object Headers** through JEP 519. ([OpenJDK][2])

## 13.3 Allocation

* Fast allocation path
* TLAB allocation
* Escape analysis
* Stack allocation illusion
* Allocation rate

## 13.4 Garbage collector taxonomy

* Throughput collector
* Low-latency collector
* Region-based collector
* Generational collector
* Concurrent collector

## 13.5 G1 GC

* Region
* Young GC
* Mixed GC
* Remembered set
* Pause target
* Evacuation failure
* Region pinning
* Late barrier expansion

JDK 25 feature set includes G1 improvements integrated since JDK 21, including **Region Pinning for G1** and **Late Barrier Expansion for G1**. ([OpenJDK][2])

## 13.6 ZGC

* Concurrent relocation
* Colored pointer
* Load barrier
* Generational ZGC
* Low latency trade-off

JDK 25 includes ZGC changes since JDK 21, including **Generational Mode by Default** and removal of non-generational mode. ([OpenJDK][2])

## 13.7 Shenandoah

* Concurrent compaction
* Brooks pointer historical model
* Generational Shenandoah
* Latency trade-off

Java 25 includes **Generational Shenandoah** through JEP 521. ([OpenJDK][2])

## 13.8 GC tuning

* Heap sizing
* Pause target
* Allocation rate
* Live set
* Promotion
* Fragmentation
* GC log reading

---

# Bagian 14 — Observability, Profiling, dan Troubleshooting

## 14.1 Observability mindset

* Metric
* Log
* Trace
* Profile
* Dump
* Event

## 14.2 JVM diagnostics

* `jcmd`
* `jstack`
* `jmap`
* `jstat`
* `jinfo`
* Native memory tracking

## 14.3 Java Flight Recorder

* Event model
* Low-overhead profiling
* Allocation profiling
* Lock profiling
* Method profiling
* CPU profiling
* Production recording strategy

Java 25 includes several JFR additions: **JFR Cooperative Sampling**, **JFR CPU-Time Profiling**, and **JFR Method Timing & Tracing**. ([OpenJDK][2])

## 14.4 Thread dump analysis

* Deadlock
* Blocked thread
* Waiting thread
* Runnable hot loop
* Pool starvation
* Virtual thread dump interpretation

## 14.5 Heap dump analysis

* Dominator tree
* Retained size
* Shallow size
* Leak suspect
* Classloader leak
* Cache leak

## 14.6 Performance profiling

* CPU profile
* Allocation profile
* Wall-clock profile
* Async-profiler
* JFR
* Flame graph
* False conclusion traps

## 14.7 Production incident analysis

* High CPU
* High memory
* GC storm
* Latency spike
* Thread starvation
* Connection leak
* Deadlock
* Metaspace leak
* Native memory leak

---

# Bagian 15 — Security, Cryptography, dan Integrity

## 15.1 Java security model

* Historical Security Manager
* Current direction
* Sandbox decline
* Integrity by default

JDK 24 permanently disabled the Security Manager, and that change is part of the JDK 25 feature set since JDK 21. ([OpenJDK][2])

## 15.2 Secure coding

* Input validation
* Output encoding
* Injection
* Deserialization attack
* Path traversal
* SSRF
* XXE
* Secret leakage
* Timing attack basics

## 15.3 Cryptography API

* JCA
* JCE
* Provider
* Cipher
* Signature
* MessageDigest
* Mac
* SecureRandom
* KeyStore
* Certificate

## 15.4 Java 25 crypto updates

* Key Derivation Function API
* PEM encodings preview
* Quantum-resistant algorithms from JDK 24

JDK 25 includes **Key Derivation Function API** and **PEM Encodings of Cryptographic Objects** as preview; it also includes post-quantum crypto additions integrated in JDK 24. ([OpenJDK][2])

## 15.5 Unsafe and native boundary

* `sun.misc.Unsafe`
* Memory access methods warning
* JNI restriction preparation
* FFM replacement direction

JDK 25 includes integrity-related changes since JDK 21, including preparing to restrict JNI and warning on unsafe memory-access methods. ([OpenJDK][2])

---

# Bagian 16 — Modules, Packaging, dan Runtime Images

## 16.1 JPMS

* `module-info.java`
* `requires`
* `exports`
* `opens`
* `uses`
* `provides`
* Readability graph
* Encapsulation
* Split package problem

## 16.2 Classpath vs module path

* Legacy compatibility
* Automatic module
* Unnamed module
* Migration strategy

## 16.3 JAR

* Manifest
* Fat jar
* Thin jar
* Multi-release jar
* Signed jar

## 16.4 Runtime image

* `jlink`
* Custom runtime
* Smaller deployment
* Container image optimization

## 16.5 Packaging

* `jpackage`
* Native installer
* Desktop distribution concern

## 16.6 Runtime image without JMODs

* Modern image linking
* Deployment impact

JDK 25 includes **Linking Run-Time Images without JMODs**, integrated in JDK 24. ([OpenJDK][2])

---

# Bagian 17 — Testing di Java

## 17.1 Testing philosophy

* Unit test
* Integration test
* Contract test
* Component test
* End-to-end test
* Property-based test
* Mutation test

## 17.2 JUnit

* Test lifecycle
* Assertion
* Parameterized test
* Dynamic test
* Extension
* Temporary file
* Timeout

## 17.3 Mockito

* Mock
* Stub
* Spy
* ArgumentCaptor
* Verification
* Misuse patterns

## 17.4 Testcontainers

* Database test
* Kafka test
* Redis test
* Elasticsearch test
* Network dependency test

## 17.5 Concurrency testing

* Race condition
* Flaky test
* Deterministic scheduler
* Awaitility
* jcstress mental model

## 17.6 Performance testing

* JMH
* Warmup
* Fork
* Blackhole
* Dead-code elimination
* Benchmark traps

---

# Bagian 18 — Enterprise Java dan Backend Engineering

## 18.1 Java backend architecture

* Layered architecture
* Hexagonal architecture
* Clean architecture
* Modulith
* Microservices
* Event-driven architecture

## 18.2 Spring ecosystem

* Spring Core
* Spring Boot
* Spring MVC
* Spring WebFlux
* Spring Data
* Spring Security
* Spring Transaction
* Spring Actuator

## 18.3 Dependency injection

* IoC container
* Bean lifecycle
* Proxy
* AOP
* Scope
* Circular dependency
* Conditional bean

## 18.4 Transaction

* JDBC transaction
* JPA transaction
* Propagation
* Isolation
* Rollback rule
* Transaction boundary
* Outbox pattern
* Saga pattern

## 18.5 Persistence

* JDBC
* JPA
* Hibernate
* MyBatis
* jOOQ
* Query performance
* N+1
* Lazy loading
* Optimistic locking
* Pessimistic locking

## 18.6 Messaging

* Kafka
* RabbitMQ
* JMS
* Idempotency
* Ordering
* Retry
* DLQ
* Backpressure
* Exactly-once illusion

## 18.7 API design

* REST
* RPC
* GraphQL
* Pagination
* Idempotency key
* Error response
* Versioning
* Compatibility

---

# Bagian 19 — Java di Cloud, Container, dan Kubernetes

## 19.1 Java in container

* Container memory detection
* CPU quota
* Heap sizing
* Native memory
* Thread count
* Startup time

## 19.2 Docker image

* JDK vs JRE image
* Distroless
* Alpine musl concern
* Layering
* Buildpack
* SBOM

## 19.3 Kubernetes

* Readiness probe
* Liveness probe
* Startup probe
* Graceful shutdown
* Resource request
* Resource limit
* HPA behavior
* JVM under CPU throttling

## 19.4 Cloud runtime behavior

* Cold start
* DNS
* TLS
* Connection pooling
* Ephemeral filesystem
* Secret management
* IAM integration

## 19.5 Production tuning

* Heap percent
* GC choice
* Thread pool
* HTTP client pool
* DB pool
* Kafka consumer parallelism
* Observability baseline

---

# Bagian 20 — Advanced Performance Engineering

## 20.1 Performance mental model

* Latency
* Throughput
* Tail latency
* Queueing
* Utilization
* Backpressure
* Coordination cost

## 20.2 Java allocation performance

* Object churn
* Boxing
* Escape analysis
* Scalar replacement
* Object pooling myth
* Buffer reuse

## 20.3 CPU performance

* Branch prediction
* Cache locality
* False sharing
* Vectorization
* Lock contention
* Memory barrier

## 20.4 Vector API

* SIMD mental model
* Use case
* Incubator status
* Numerical workload
* Image/data processing
* Risk of premature adoption

Java 25 includes **Vector API** as tenth incubator. ([OpenJDK][2])

## 20.5 Low-latency Java

* GC selection
* Allocation discipline
* P99/P999
* Mechanical sympathy
* Real-time-ish constraints
* Trading system lessons

## 20.6 Benchmark methodology

* JMH
* Warmup
* Profile-guided analysis
* GC log correlation
* CPU flame graph
* Allocation flame graph
* Avoiding fake benchmark wins

---

# Bagian 21 — Framework Internals: Kenapa Framework Java Bisa Bekerja

## 21.1 Reflection

* Class metadata
* Method invocation
* Field access
* Constructor access
* Annotation scanning
* Performance cost
* Encapsulation issue

## 21.2 Annotation

* Source retention
* Class retention
* Runtime retention
* Annotation processor
* Compile-time code generation

## 21.3 Proxy

* JDK dynamic proxy
* CGLIB
* Byte Buddy
* AOP
* Transaction proxy
* Security proxy
* Self-invocation bug

## 21.4 Classpath scanning

* Resource scanning
* Metadata reading
* Startup cost
* Native image issue

## 21.5 Instrumentation

* Java agent
* Bytecode transformation
* OpenTelemetry agent
* Profiling agent
* Security agent

## 21.6 Serialization framework internals

* Jackson
* Gson
* JSON-B
* Reflection vs generated accessor
* Record support
* Polymorphic deserialization risk

---

# Bagian 22 — Design Principles dan Domain Modeling dengan Java

## 22.1 Java sebagai language untuk modeling

* Entity
* Value object
* Aggregate
* Domain service
* Application service
* Repository
* Policy
* Specification
* State machine

## 22.2 Invariant modeling

* Constructor invariant
* Factory method
* Validation boundary
* Illegal state prevention
* Temporal invariant
* Cross-aggregate invariant

## 22.3 State machine modeling

* Enum state
* Sealed state hierarchy
* Transition object
* Guard
* Effect
* Audit trail
* Regulatory defensibility

## 22.4 Command/event modeling

* Command
* Event
* Query
* Idempotency
* Causality
* Correlation ID
* Versioning

## 22.5 Error modeling

* Exception vs result type
* Sealed error
* Domain rejection
* Technical failure
* Retry policy

## 22.6 API surface design

* Immutability
* Minimal exposure
* Defensive copy
* Null policy
* Optional policy
* Compatibility

---

# Bagian 23 — Migration: Java 8 → 11 → 17 → 21 → 25

## 23.1 Migration mindset

* Source compatibility
* Binary compatibility
* Behavioral compatibility
* Dependency compatibility
* Toolchain compatibility
* Runtime compatibility

## 23.2 Java 8 to modern Java

* Lambda maturity
* Stream API misuse
* Date-Time migration
* Optional misuse
* Default method compatibility

## 23.3 Java 9 module impact

* Encapsulation
* Illegal reflective access
* Removed internal API dependency
* Classpath/module path issue

## 23.4 Java 11 migration

* Removed Java EE modules
* HTTP Client standardization
* TLS and crypto changes
* Build plugin updates

## 23.5 Java 17 migration

* Strong encapsulation
* Records
* Sealed classes
* Pattern matching
* GC updates

## 23.6 Java 21 migration

* Virtual threads
* Sequenced collections
* Record patterns
* Pattern switch
* Modern concurrency shift

## 23.7 Java 25 migration

* Language feature updates
* Runtime changes
* GC changes
* JFR additions
* Security changes
* Removed 32-bit x86 port
* Preview/incubator feature policy

Java 25 includes removal of the 32-bit x86 port and several preview/incubator features, so migration planning must separate stable platform features from preview/incubator adoption. ([OpenJDK][2])

---

# Bagian 24 — Java Code Quality Standards

## 24.1 Naming

* Package
* Class
* Interface
* Method
* Variable
* Constant
* Generic type parameter

## 24.2 Method design

* Cohesion
* Side effect
* Return type
* Exception
* Nullability
* Overload
* Parameter object

## 24.3 Class design

* Immutability
* Encapsulation
* Constructor policy
* Factory method
* Static utility
* Dependency injection

## 24.4 Package design

* Boundary
* Dependency direction
* API vs internal
* Feature module
* Domain module
* Infrastructure module

## 24.5 Anti-pattern

* God service
* Anemic domain model
* Transaction script
* Static everywhere
* Reflection abuse
* Optional field
* Exception swallowing
* Over-generic abstraction

## 24.6 Review checklist

* Correctness
* Readability
* Complexity
* Testability
* Performance
* Thread safety
* Observability
* Migration safety

---

# Bagian 25 — Capstone Projects

## 25.1 Capstone 1 — Java language mastery

Membangun small interpreter / expression evaluator dengan:

* Sealed AST
* Pattern matching
* Records
* Visitor alternative
* Error modeling
* Parser
* Evaluator

## 25.2 Capstone 2 — High-performance file processor

Membangun CLI pemroses file besar dengan:

* NIO
* Charset decoder
* Streaming tokenizer
* Bounded memory
* Parallel processing
* JFR profiling
* GC tuning
* JMH microbenchmark

## 25.3 Capstone 3 — Concurrent service engine

Membangun task processing engine dengan:

* Virtual threads
* Structured concurrency
* Scoped values
* Backpressure
* Cancellation
* Timeout
* Retry
* Failure aggregation

## 25.4 Capstone 4 — Domain-heavy case management model

Membangun enforcement/case lifecycle model dengan:

* State machine
* Sealed transition
* Domain event
* Audit trail
* Idempotent command
* Regulatory reasoning
* Escalation policy

## 25.5 Capstone 5 — Production-grade Java service

Membangun service lengkap dengan:

* Spring Boot
* PostgreSQL
* Kafka
* Outbox
* Observability
* JFR
* Docker
* Kubernetes
* Load test
* Failure injection

---

[1]: https://openjdk.org/projects/jdk/25/ "JDK 25"
[2]: https://openjdk.org/projects/jdk/25/jeps-since-jdk-21 "JEPs in JDK 25 integrated since JDK 21"
[3]: https://openjdk.org/projects/jdk/ "JDK"
[4]: https://docs.oracle.com/en/java/javase/25/ "JDK 25 Documentation - Home"
