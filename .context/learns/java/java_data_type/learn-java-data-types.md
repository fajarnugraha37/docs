## Rencana Seri: Advanced Java Data Types

### `learn-java-data-types-part-000.md` — Peta Besar Java Type System

Bagian pembuka ini membangun mental model: tipe bukan sekadar “wadah nilai”, tetapi kontrak antara compiler, runtime, memory, API, database, serializer, framework, dan manusia.

Isi utama:

* apa arti “type” di Java;
* value, variable, expression, object, reference;
* compile-time type vs runtime class;
* primitive vs reference;
* null type;
* nominal typing di Java;
* static typing vs dynamic behavior;
* type sebagai boundary correctness;
* type sebagai dokumentasi executable;
* type sebagai mekanisme mencegah illegal state;
* type system Java dibanding Go/Rust/Kotlin/C# secara konseptual;
* kenapa top engineer tidak memakai `String`, `int`, `boolean` secara sembarangan.

---

### `learn-java-data-types-part-001.md` — Primitive Types: Semantics, Range, Conversion, dan Pitfall

Deep dive primitive Java.

Isi utama:

* `byte`, `short`, `int`, `long`;
* `char` sebagai unsigned 16-bit code unit, bukan “karakter manusia”;
* `float`, `double`;
* `boolean`;
* numeric range dan overflow;
* integer literal, binary/hex/octal literal;
* signed integer behavior;
* arithmetic promotion;
* narrowing/widening conversion;
* compound assignment trap;
* `char` arithmetic trap;
* `NaN`, infinity, `-0.0`;
* equality floating point;
* primitive default values;
* primitive dalam field, local variable, array;
* kapan primitive tepat, kapan value object lebih baik.

---

### `learn-java-data-types-part-002.md` — Numeric Types untuk Production: Money, Quantity, Counter, ID, Version

Bagian ini membahas angka sebagai domain concept, bukan hanya `int`.

Isi utama:

* kenapa `double` buruk untuk uang;
* `BigDecimal` scale, precision, rounding;
* `BigInteger`;
* `long` untuk money minor unit;
* overflow counter;
* optimistic lock version;
* timestamp epoch millis/nanos;
* sequence number;
* database numeric mapping;
* JSON number precision issue;
* JavaScript number boundary;
* metric counter vs business counter;
* regulatory/reporting precision;
* anti-pattern: `double amount`;
* pattern: `Money`, `Quantity`, `Percentage`, `Ratio`, `Version`.

---

### `learn-java-data-types-part-003.md` — Floating Point Deep Dive: IEEE 754, NaN, Precision, dan Determinism

Fokus untuk memahami floating point secara benar.

Isi utama:

* representasi floating point;
* binary fraction;
* rounding error;
* `0.1 + 0.2`;
* `NaN != NaN`;
* positive/negative infinity;
* positive/negative zero;
* `Float.compare` dan `Double.compare`;
* `strictfp` dan sejarahnya;
* determinism lintas platform modern;
* tolerance comparison;
* numeric stability;
* performance vs correctness;
* kapan `double` benar;
* kapan `BigDecimal` benar;
* kapan fixed-point lebih baik.

---

### `learn-java-data-types-part-004.md` — `boolean`, Flag, State, dan Decision Modeling

Bagian ini membahas jebakan `boolean`.

Isi utama:

* `boolean` sebagai primitive;
* flag explosion;
* boolean blindness;
* parameter boolean anti-pattern;
* impossible states dari banyak boolean;
* `isActive`, `isDeleted`, `isApproved`, `isRejected`;
* enum vs boolean;
* sealed result vs boolean return;
* decision object;
* policy decision dengan reason;
* feature flag vs domain flag;
* auditability dari decision;
* pattern: `Decision`, `Eligibility`, `ApprovalOutcome`;
* anti-pattern: `return true/false` untuk rule kompleks.

---

### `learn-java-data-types-part-005.md` — `char`, Unicode, Code Point, String, dan Text Data

Walaupun ada seri string tersendiri, bagian ini fokus dari sudut type system.

Isi utama:

* `char` bukan Unicode character penuh;
* UTF-16 code unit;
* code point;
* surrogate pair;
* grapheme cluster;
* `String.length()` vs user-perceived character count;
* `Character` API;
* normalization;
* case conversion locale issue;
* Turkish `I`;
* emoji;
* database collation;
* security issue pada confusable characters;
* identifier/code/name validation;
* boundary: internal text vs user-facing text.

---

### `learn-java-data-types-part-006.md` — Reference Types: Object, Identity, Reference, dan Null

Deep dive reference model.

Isi utama:

* object vs reference;
* identity vs equality;
* heap allocation;
* object header secara konseptual;
* reference variable;
* aliasing;
* pass-by-value of reference;
* `null`;
* NPE modern helpful message;
* null as absence vs invalid state;
* `Optional` boundary;
* sentinel object;
* Null Object pattern;
* nullability annotation;
* defensive programming;
* ownership dan mutability.

---

### `learn-java-data-types-part-007.md` — `Object`, Equality, Hashing, Identity, dan Ordering

Bagian ini membahas kontrak object paling fundamental.

Isi utama:

* `Object`;
* `equals`;
* `hashCode`;
* `toString`;
* `getClass`;
* `clone` problem;
* identity equality;
* value equality;
* entity equality;
* record equality;
* inheritance dan equals symmetry trap;
* hashCode stability;
* mutable key bug;
* `Comparable`;
* `Comparator`;
* natural ordering;
* sorting consistency;
* `TreeMap`/`TreeSet` equality trap;
* production bug karena wrong equality.

---

### `learn-java-data-types-part-008.md` — Wrapper Types, Boxing, Unboxing, Cache, dan Primitive Collections

Isi utama:

* `Integer`, `Long`, `Boolean`, etc.;
* boxing/unboxing;
* autoboxing bytecode mental model;
* wrapper cache;
* `Integer == Integer` trap;
* NPE dari unboxing null;
* boxing dalam stream;
* boxing dalam collection;
* memory overhead;
* performance cost;
* primitive array vs `List<Integer>`;
* primitive specialized library;
* wrapper untuk nullable DB column;
* wrapper untuk generics;
* wrapper as value object? kapan tidak cukup.

---

### `learn-java-data-types-part-009.md` — Arrays: Type, Covariance, Memory Layout, dan Performance

Isi utama:

* array sebagai reference type;
* primitive array vs object array;
* array covariance;
* `ArrayStoreException`;
* reified component type;
* array length final;
* bounds check;
* bounds check elimination;
* multidimensional array sebagai array of arrays;
* jagged array;
* array copying;
* `System.arraycopy`;
* `Arrays` utility;
* array vs `List`;
* array mutability;
* defensive copy;
* varargs;
* heap pollution via varargs generics.

---

### `learn-java-data-types-part-010.md` — `String` sebagai Data Type: Identity, Interning, Immutability, dan Memory

Isi utama:

* `String` sebagai reference type khusus;
* string literal;
* intern pool;
* `String.intern`;
* immutability;
* compact strings;
* concatenation;
* `StringBuilder`;
* text blocks;
* equality;
* substring behavior modern;
* string deduplication;
* sensitive data problem;
* password as `char[]` vs `String`;
* canonicalization;
* string as ID anti-pattern;
* typed ID value object.

---

### `learn-java-data-types-part-011.md` — Enum: Closed Set, Behavior, State, dan Compatibility

Isi utama:

* enum as type-safe constants;
* enum identity;
* enum constructor/fields/methods;
* enum switch;
* enum map/set;
* ordinal trap;
* name compatibility;
* database mapping;
* JSON mapping;
* adding enum value as breaking change;
* enum with behavior;
* state machine with enum;
* enum vs sealed type;
* enum as strategy;
* anti-pattern: status string.

---

### `learn-java-data-types-part-012.md` — Records: Transparent Data Carrier, Value Semantics, dan Domain Value Object

Records sudah final sejak Java 16 via JEP 395, dan dirancang sebagai class yang secara eksplisit menjadi transparent carrier untuk immutable data. ([Oracle Docs][3])

Isi utama:

* record semantics;
* canonical constructor;
* compact constructor;
* validation;
* normalization;
* generated equals/hashCode/toString;
* shallow immutability;
* mutable component trap;
* record as DTO;
* record as command/event/result;
* record as value object;
* record vs entity;
* record and serialization;
* record and JPA limitation;
* record patterns;
* API evolution issues.

---

### `learn-java-data-types-part-013.md` — Sealed Types: Closed Hierarchy untuk State, Error, dan Domain Alternatives

Sealed classes membuat hierarki lebih terkendali dan membantu compiler melakukan exhaustiveness analysis, terutama ketika dikombinasikan dengan pattern matching. ([OpenJDK][4])

Isi utama:

* `sealed`, `permits`;
* `final`, `sealed`, `non-sealed`;
* sealed interface;
* closed domain alternatives;
* sealed command hierarchy;
* sealed error hierarchy;
* sealed state machine;
* exhaustiveness with switch;
* sealed vs enum;
* sealed vs inheritance bebas;
* module/package rules;
* API evolution risk;
* serialization/persistence concern.

---

### `learn-java-data-types-part-014.md` — Pattern Matching dan Type Refinement

Java SE 25 documentation menjelaskan `switch` dapat bekerja dengan selector expression berupa reference atau primitive type, dan pattern matching membuat kontrol flow berdasarkan bentuk/type data menjadi lebih ekspresif. ([Oracle Docs][5])

Isi utama:

* pattern matching for `instanceof`;
* pattern matching for `switch`;
* type pattern;
* guarded pattern;
* null handling in switch;
* exhaustiveness;
* record pattern;
* nested record pattern;
* primitive patterns preview di Java 25;
* pattern matching sebagai data modeling tool;
* anti-pattern: giant if-else type checking;
* readability boundary.

---

### `learn-java-data-types-part-015.md` — Generics: Type Parameter, Erasure, Wildcard, dan Type Safety

Isi utama:

* why generics exist;
* type parameter;
* parameterized type;
* raw type;
* type erasure;
* bridge method;
* reifiable vs non-reifiable type;
* wildcard `?`;
* upper/lower bound;
* PECS;
* generic method;
* generic class;
* heap pollution;
* unchecked cast;
* `Class<T>`;
* `Type`, `ParameterizedType`;
* type token pattern;
* framework generic introspection;
* generics dalam API design.

---

### `learn-java-data-types-part-016.md` — Collections sebagai Data Types: List, Set, Map, Queue, Sequenced Collections

Isi utama:

* collection bukan hanya container;
* `List` semantic;
* `Set` semantic;
* `Map` semantic;
* `Queue`/`Deque`;
* Java 21 Sequenced Collections;
* mutability;
* unmodifiable vs immutable;
* defensive copy;
* collection equality;
* ordering;
* concurrency;
* collection as API boundary;
* empty collection vs null;
* pagination and bounded result;
* high-cardinality collection risk.

---

### `learn-java-data-types-part-017.md` — Optional, Absence, Nullability, dan Result Modeling

Isi utama:

* `Optional<T>` semantics;
* Optional as return type;
* Optional as field/parameter debate;
* absence vs failure;
* null vs empty collection;
* `OptionalInt`, `OptionalLong`, `OptionalDouble`;
* domain result;
* sealed result;
* error object;
* validation result;
* optional in JSON/JPA;
* performance concern;
* anti-pattern: `Optional.get`;
* API design rules.

---

### `learn-java-data-types-part-018.md` — Date and Time Types: Instant, LocalDate, ZonedDateTime, Duration, Period

Isi utama:

* legacy `Date`/`Calendar` problem;
* `Instant`;
* `LocalDate`;
* `LocalDateTime`;
* `ZonedDateTime`;
* `OffsetDateTime`;
* `Duration`;
* `Period`;
* `Clock`;
* timezone;
* DST;
* business calendar;
* deadline modeling;
* database timestamp mapping;
* JSON date format;
* audit timestamp;
* regulatory cutoff;
* anti-pattern: direct `now()` in domain.

---

### `learn-java-data-types-part-019.md` — Domain-Specific Types: Typed ID, Money, Email, Name, Status, Reason

Isi utama:

* primitive obsession;
* typed ID;
* value object validation;
* email type;
* phone type;
* case number;
* officer ID;
* policy version;
* money;
* percentage;
* severity;
* reason;
* evidence reference;
* constructor validation;
* normalization;
* serialization/persistence mapping;
* balancing type richness vs overengineering.

---

### `learn-java-data-types-part-020.md` — Mutability, Immutability, Defensive Copy, dan Ownership

Isi utama:

* mutable object;
* immutable object;
* shallow vs deep immutability;
* final field semantics;
* safe publication;
* defensive copy;
* collection mutability leak;
* builder pattern;
* wither pattern;
* persistent data structure;
* concurrency implications;
* entity controlled mutability;
* value object immutability;
* records shallow immutability trap.

---

### `learn-java-data-types-part-021.md` — Data Types dan Java Memory Model

Isi utama:

* variable visibility;
* primitive atomicity;
* `long`/`double` historical concern;
* reference assignment atomicity;
* final field guarantee;
* volatile reference vs object state;
* immutable object publication;
* data race;
* thread-safe value object;
* arrays and visibility;
* `AtomicReference<T>`;
* VarHandle;
* data type choice in concurrent code.

---

### `learn-java-data-types-part-022.md` — Data Layout, Object Header, Alignment, Compressed Oops, dan Memory Footprint

Isi utama:

* conceptual object layout;
* object header;
* mark word;
* class pointer;
* compressed ordinary object pointers;
* alignment/padding;
* primitive field layout;
* reference field layout;
* array layout;
* object graph overhead;
* `List<Integer>` vs `int[]`;
* false sharing;
* memory estimation;
* JOL introduction;
* compact object headers in modern JDK direction;
* memory-sensitive design.

---

### `learn-java-data-types-part-023.md` — Data Types and Performance: Allocation, Cache Locality, Boxing, Escape Analysis

Isi utama:

* allocation rate;
* scalar replacement;
* escape analysis;
* primitive vs wrapper;
* array vs object graph;
* cache locality;
* branch predictability;
* `BigDecimal` cost;
* string churn;
* DTO mapping cost;
* collection overhead;
* benchmark dengan JMH;
* JFR allocation profiling;
* when to optimize data representation.

---

### `learn-java-data-types-part-024.md` — Serialization Boundary: JSON, XML, Binary, Java Serialization

Isi utama:

* data type crossing process boundary;
* DTO vs domain object;
* Jackson mapping;
* records and Jackson;
* enum compatibility;
* date/time format;
* BigDecimal precision;
* optional/null handling;
* polymorphic type security;
* Java native serialization risk;
* Avro/Protobuf schema;
* versioning;
* backward/forward compatibility;
* contract tests.

---

### `learn-java-data-types-part-025.md` — Database Mapping: Java Types ke SQL Types

Isi utama:

* Java primitive/reference to DB columns;
* nullable column vs primitive;
* `BigDecimal` precision/scale;
* `Instant` vs `Timestamp`;
* enum mapping;
* UUID;
* JSON column;
* array/collection mapping;
* embeddable value object;
* JPA converter;
* JDBC type;
* database constraint vs domain validation;
* migration compatibility;
* ORM lazy proxy and type boundary.

---

### `learn-java-data-types-part-026.md` — API Contract Data Types: REST, GraphQL, gRPC, Event Schema

Isi utama:

* internal type vs external contract;
* stringly typed API;
* ID format;
* enum evolution;
* date/time;
* decimal;
* boolean flags;
* pagination types;
* error types;
* OpenAPI schema;
* GraphQL scalar;
* Protobuf type constraints;
* Avro schema evolution;
* event versioning;
* consumer compatibility.

---

### `learn-java-data-types-part-027.md` — Validation, Constraint, and Type-Driven Design

Isi utama:

* validation layer vs domain invariant;
* Jakarta Validation;
* custom constraint;
* constructor validation;
* fail-fast vs collect errors;
* normalized type;
* invalid object prevention;
* error message;
* regulatory defensibility;
* validation result type;
* anti-pattern: validate everywhere repeatedly;
* type-driven validation.

---

### `learn-java-data-types-part-028.md` — Security Implications of Data Types

Isi utama:

* string secrets;
* char array password debate;
* byte array lifecycle;
* constant-time comparison;
* canonicalization;
* Unicode spoofing;
* deserialization vulnerabilities;
* numeric overflow security;
* path traversal type;
* URL/URI type confusion;
* SQL injection and parameter types;
* crypto key types;
* sensitive data masking;
* log-safe types.

---

### `learn-java-data-types-part-029.md` — Reflection, Type Metadata, and Runtime Type Inspection

Isi utama:

* `Class<T>`;
* `Type`;
* `ParameterizedType`;
* `TypeVariable`;
* `WildcardType`;
* `GenericArrayType`;
* annotation on type use;
* runtime generic metadata;
* type erasure limitation;
* framework introspection;
* Jackson/Spring/Hibernate type resolution;
* proxy class vs target class;
* type token;
* super type token pattern.

---

### `learn-java-data-types-part-030.md` — Advanced Type Modeling Patterns

Isi utama:

* tiny types;
* phantom type pattern;
* sealed ADT-style modeling;
* typestate pattern;
* builder with staged types;
* unit-of-measure modeling;
* state-specific object;
* capability type;
* marker interface with caution;
* generic domain ID;
* type-safe heterogeneous container;
* visitor vs pattern matching;
* avoiding over-modeling.

---

### `learn-java-data-types-part-031.md` — Anti-Patterns: Primitive Obsession, Stringly Typed Code, Map-Driven Domain

Isi utama:

* `Map<String, Object>` domain;
* `String status`;
* `boolean approved/rejected`;
* `int type`;
* DTO reused as domain;
* entity reused as API;
* `Object` as escape hatch;
* raw type;
* unchecked cast everywhere;
* mutable key;
* `Optional.get`;
* null sentinel;
* overuse of inheritance;
* overuse of marker interface;
* misleading type names.

---

### `learn-java-data-types-part-032.md` — Production Failure Case Studies around Java Data Types

Isi utama:

* money rounding bug;
* JSON number precision bug;
* enum value breaks consumer;
* timezone deadline bug;
* mutable HashMap key bug;
* NPE from unboxing;
* `Integer == Integer` bug;
* N+1 due to entity serialization;
* cache memory leak from unbounded key type;
* status string typo causing invalid state;
* audit failure due to boolean decision;
* Unicode validation bypass;
* Java migration serialization issue.

---

### `learn-java-data-types-part-033.md` — Java Data Types Design Review Checklist

Isi utama:

* checklist primitive choice;
* checklist value object;
* checklist enum/sealed;
* checklist nullability;
* checklist mutability;
* checklist collection API;
* checklist serialization;
* checklist DB mapping;
* checklist API schema;
* checklist security;
* checklist performance;
* checklist migration compatibility;
* review questions for senior engineers.

---

### `learn-java-data-types-part-034.md` — Capstone: Designing a Type-Safe Enforcement Case Domain Model

Isi utama:

* domain requirements;
* typed IDs;
* value objects;
* state machine;
* sealed command/event/error;
* records for command/event/result;
* aggregate with invariants;
* audit trail;
* API DTO mapping;
* DB mapping;
* JSON contract;
* tests;
* performance and memory review;
* migration/versioning review;
* final architecture.

---

[1]: https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html?utm_source=chatgpt.com "Chapter 4. Types, Values, and Variables"
[2]: https://docs.oracle.com/javase/specs/jvms/se25/html/index.html?utm_source=chatgpt.com "The Java® Virtual Machine Specification"
[3]: https://docs.oracle.com/javase/specs/jls/se25/html/index.html?utm_source=chatgpt.com "The Java® Language Specification"
[4]: https://openjdk.org/jeps/409?utm_source=chatgpt.com "JEP 409: Sealed Classes"
[5]: https://docs.oracle.com/en/java/javase/25/language/pattern-matching-switch.html?utm_source=chatgpt.com "Pattern Matching with switch - Java"
