# learn-java-data-types-part-029.md

# Java Data Types — Part 029  
# Reflection, Type Metadata, Runtime Type Inspection, MethodHandles, VarHandle, dan Type-Safe Introspection

> Seri: **Advanced Java Data Types**  
> Bagian: **029**  
> Fokus: memahami bagaimana Java merepresentasikan type metadata pada runtime: `Class<?>`, reflection API, fields/methods/constructors/annotations, generic metadata, type erasure, records, sealed types, enums, arrays, modules, accessibility, MethodHandles, VarHandle, framework usage, performance, security, and when reflection is the right tool vs design smell.

---

## Daftar Isi

1. [Tujuan Bagian Ini](#1-tujuan-bagian-ini)
2. [Mental Model: Compile-Time Type vs Runtime Metadata](#2-mental-model-compile-time-type-vs-runtime-metadata)
3. [`Class<?>`: Runtime Type Token](#3-class-runtime-type-token)
4. [Getting Class Objects](#4-getting-class-objects)
5. [Runtime Class vs Static Type](#5-runtime-class-vs-static-type)
6. [Reflection Package Overview](#6-reflection-package-overview)
7. [Fields, Methods, Constructors](#7-fields-methods-constructors)
8. [`getMethods` vs `getDeclaredMethods`](#8-getmethods-vs-getdeclaredmethods)
9. [Annotations as Metadata](#9-annotations-as-metadata)
10. [Generic Type Metadata dan Erasure](#10-generic-type-metadata-dan-erasure)
11. [`Type`, `ParameterizedType`, `TypeVariable`, `WildcardType`](#11-type-parameterizedtype-typevariable-wildcardtype)
12. [Type Token Pattern](#12-type-token-pattern)
13. [Arrays dan Reflection](#13-arrays-dan-reflection)
14. [Enum Reflection](#14-enum-reflection)
15. [Record Reflection](#15-record-reflection)
16. [Sealed Type Reflection](#16-sealed-type-reflection)
17. [Module System dan Reflective Access](#17-module-system-dan-reflective-access)
18. [Accessibility, Encapsulation, dan `setAccessible`](#18-accessibility-encapsulation-dan-setaccessible)
19. [Method Invocation via Reflection](#19-method-invocation-via-reflection)
20. [Constructor Invocation](#20-constructor-invocation)
21. [Dynamic Proxies](#21-dynamic-proxies)
22. [MethodHandles](#22-methodhandles)
23. [VarHandle](#23-varhandle)
24. [Reflection vs MethodHandle vs Direct Call](#24-reflection-vs-methodhandle-vs-direct-call)
25. [Framework Use Cases](#25-framework-use-cases)
26. [Reflection and Serialization/Deserialization](#26-reflection-and-serializationdeserialization)
27. [Reflection and Dependency Injection](#27-reflection-and-dependency-injection)
28. [Reflection and Validation/ORM](#28-reflection-and-validationorm)
29. [Performance Considerations](#29-performance-considerations)
30. [Security Considerations](#30-security-considerations)
31. [Reflection in Native Image/AOT Environments](#31-reflection-in-native-imageaot-environments)
32. [Design Smells: When Reflection Should Be Avoided](#32-design-smells-when-reflection-should-be-avoided)
33. [Type-Safe Alternatives](#33-type-safe-alternatives)
34. [Production Failure Modes](#34-production-failure-modes)
35. [Best Practices](#35-best-practices)
36. [Decision Matrix](#36-decision-matrix)
37. [Latihan](#37-latihan)
38. [Ringkasan](#38-ringkasan)
39. [Referensi](#39-referensi)

---

# 1. Tujuan Bagian Ini

Reflection memungkinkan program membaca metadata type saat runtime.

Contoh:

```java
Class<?> clazz = CaseId.class;

System.out.println(clazz.getName());
System.out.println(clazz.isRecord());
System.out.println(Arrays.toString(clazz.getRecordComponents()));
```

Dengan reflection, framework bisa:

- membuat object dari constructor;
- membaca annotation;
- menemukan fields;
- memanggil method;
- mapping JSON ke object;
- mapping entity ke table;
- menjalankan validation;
- melakukan dependency injection;
- membuat proxy;
- membaca generic signature;
- inspect record components;
- inspect sealed permitted subclasses.

Tetapi reflection juga punya biaya:

- runtime error instead of compile-time error;
- performance overhead;
- encapsulation bypass;
- module access issue;
- security risk;
- harder static analysis;
- AOT/native-image configuration;
- brittle code if based on string names.

Tujuan bagian ini:

- memahami `Class<?>` sebagai runtime type token;
- memahami Java reflection API;
- memahami generic metadata vs type erasure;
- memahami records/sealed reflection;
- memahami annotations;
- memahami MethodHandles/VarHandle;
- memahami kapan reflection tepat;
- memahami kapan reflection adalah design smell;
- membuat reflection usage lebih type-safe dan production-ready.

---

# 2. Mental Model: Compile-Time Type vs Runtime Metadata

Java punya static type checking.

```java
CaseId id = new CaseId("CASE-000001");
```

Compiler tahu variable `id` bertipe `CaseId`.

Runtime object juga punya class metadata.

```java
Class<?> runtimeType = id.getClass();
```

## 2.1 Compile-time type

Digunakan compiler untuk:

- overload resolution;
- type checking;
- generics checking;
- method availability;
- casts.

## 2.2 Runtime class

Digunakan JVM untuk:

- dynamic dispatch;
- reflection;
- class loading;
- `instanceof`;
- array store checks;
- serialization frameworks;
- annotations.

## 2.3 Static type can be broader

```java
Object x = new CaseId("CASE-000001");
```

Compile-time type: `Object`.

Runtime class: `CaseId`.

## 2.4 Interface reference

```java
List<String> list = new ArrayList<>();
```

Compile-time type: `List`.

Runtime class: `ArrayList`.

## 2.5 Reflection sees runtime/class metadata

Reflection can inspect class structure, but generic type info is limited by erasure and metadata availability.

---

# 3. `Class<?>`: Runtime Type Token

`Class` instances represent classes and interfaces in a running Java application.

```java
Class<CaseId> caseIdClass = CaseId.class;
```

## 3.1 Class object

Every loaded class/interface/primitive/array type has a `Class` object.

Examples:

```java
String.class
int.class
int[].class
void.class
List.class
```

## 3.2 Generic Class object

```java
Class<String> stringClass = String.class;
Class<?> unknown = Class.forName("java.lang.String");
```

## 3.3 Class as key

Frameworks often use `Class<?>` as registry key.

```java
Map<Class<?>, Handler<?>> handlers;
```

## 3.4 Class as bounded token

```java
<T> T convert(String raw, Class<T> targetType)
```

Works for non-parameterized type like `Integer.class`.

Does not capture `List<String>` fully.

## 3.5 Runtime type metadata

`Class` can answer:

- name;
- package/module;
- superclass;
- interfaces;
- modifiers;
- fields;
- methods;
- constructors;
- annotations;
- record status;
- sealed status;
- enum status;
- array component type.

---

# 4. Getting Class Objects

## 4.1 `.class`

```java
Class<String> c = String.class;
```

## 4.2 `getClass()`

```java
String s = "hello";
Class<?> c = s.getClass();
```

## 4.3 `Class.forName`

```java
Class<?> c = Class.forName("com.example.CaseId");
```

Can trigger class loading/initialization depending overload.

## 4.4 Primitive class

```java
int.class
boolean.class
void.class
```

## 4.5 Array class

```java
String[].class
int[][].class
```

## 4.6 Framework caution

Using class names as strings is brittle and can be unsafe if input-controlled.

---

# 5. Runtime Class vs Static Type

## 5.1 Example

```java
Number n = Integer.valueOf(42);

System.out.println(n.getClass()); // class java.lang.Integer
```

Static type `Number`, runtime class `Integer`.

## 5.2 Polymorphism

Reflection on `n.getClass()` sees actual implementation.

Reflection on `Number.class` sees abstract/base class.

## 5.3 Proxy

Spring/JDK proxies can change runtime class.

```java
service.getClass()
```

may return proxy class, not original implementation.

## 5.4 Hibernate proxy

Entity runtime class may be proxy subclass.

Do not rely blindly on `getClass()` for entity equality.

## 5.5 Rule

In framework-heavy code, runtime class may not be the domain class you expect.

---

# 6. Reflection Package Overview

Java SE 25 `java.lang.reflect` package summary says reflection allows programmatic access to information about fields, methods, and constructors of loaded classes, and use of reflected fields, methods, and constructors to operate on their underlying counterparts.

Important classes/interfaces:

```java
Field
Method
Constructor
Parameter
AnnotatedElement
Type
ParameterizedType
TypeVariable
WildcardType
GenericArrayType
RecordComponent
InvocationHandler
Proxy
Modifier
Array
```

## 6.1 Metadata

Inspect structure.

## 6.2 Dynamic access

Read/write fields, invoke methods, construct instances.

## 6.3 Annotation access

Annotations are metadata on program elements.

## 6.4 Generic metadata

Read generic declarations/signatures where retained.

## 6.5 Cost

Reflection shifts errors from compile time to runtime.

---

# 7. Fields, Methods, Constructors

## 7.1 Field

```java
Field field = clazz.getDeclaredField("value");
```

Can inspect:

- name;
- type;
- generic type;
- modifiers;
- annotations.

## 7.2 Method

```java
Method method = clazz.getDeclaredMethod("value");
```

Can inspect:

- name;
- return type;
- parameter types;
- exceptions;
- annotations.

## 7.3 Constructor

```java
Constructor<CaseId> ctor = CaseId.class.getDeclaredConstructor(String.class);
```

Can create object:

```java
CaseId id = ctor.newInstance("CASE-000001");
```

## 7.4 Parameter names

Parameter names may require compilation with `-parameters` to be available reliably for methods/constructors.

Records have component names by language model.

## 7.5 Modifiers

```java
Modifier.isPublic(method.getModifiers())
```

## 7.6 Reflection exceptions

Expect:

- `NoSuchMethodException`;
- `NoSuchFieldException`;
- `IllegalAccessException`;
- `InvocationTargetException`;
- `InstantiationException`.

---

# 8. `getMethods` vs `getDeclaredMethods`

Java SE 25 `Class` API distinguishes public inherited methods and declared methods.

## 8.1 `getMethods`

Returns public methods of class/interface including inherited public methods.

```java
Method[] methods = clazz.getMethods();
```

## 8.2 `getDeclaredMethods`

Returns methods declared by the class/interface itself, including public/protected/package/private, but excluding inherited methods.

```java
Method[] declared = clazz.getDeclaredMethods();
```

## 8.3 Similar pairs

Fields:

```java
getFields()
getDeclaredFields()
```

Constructors:

```java
getConstructors()
getDeclaredConstructors()
```

## 8.4 Common bug

Framework scans `getDeclaredMethods()` and misses inherited method annotations.

Or scans `getMethods()` and unexpectedly includes Object methods.

## 8.5 Rule

Choose method based on whether inheritance should count.

---

# 9. Annotations as Metadata

Annotations can be retained in class files/runtime.

## 9.1 Retention

```java
@Retention(RetentionPolicy.RUNTIME)
```

Needed for runtime reflection.

## 9.2 Target

```java
@Target({ElementType.FIELD, ElementType.METHOD, ElementType.RECORD_COMPONENT})
```

## 9.3 Reading annotation

```java
MyAnnotation ann = clazz.getAnnotation(MyAnnotation.class);
```

## 9.4 Annotation on record component

Record component annotations may also be propagated to accessor/field/constructor parameter depending annotation target.

Inspect carefully.

## 9.5 Repeated annotations

Java supports repeatable annotations.

## 9.6 Rule

Annotations are code metadata. They should be stable and intentionally targeted.

---

# 10. Generic Type Metadata dan Erasure

Generics are mostly erased at runtime.

```java
List<String> names = List.of("a");
System.out.println(names.getClass()); // immutable list implementation, not List<String>
```

## 10.1 Erasure

Runtime class generally does not know `List<String>` vs `List<Integer>` for an instance.

## 10.2 Generic signatures

Class/method/field declarations can retain generic signature metadata.

Example:

```java
class User {
    List<String> names;
}
```

Reflection can inspect `Field.getGenericType()` and see `List<String>`.

## 10.3 Method parameter metadata

```java
void handle(List<CaseId> ids)
```

Reflection can inspect generic parameter type.

## 10.4 Instance loses type argument

```java
new ArrayList<String>().getClass()
```

does not preserve `String`.

## 10.5 Framework consequence

JSON libraries need type references for `List<CaseResponse>`.

## 10.6 Rule

`Class<T>` is not enough for parameterized types.

---

# 11. `Type`, `ParameterizedType`, `TypeVariable`, `WildcardType`

Java reflection uses `Type` hierarchy.

## 11.1 `Class`

Represents raw class or primitive/array class.

```java
String.class
List.class
int.class
```

## 11.2 `ParameterizedType`

Represents `List<String>` in declarations.

```java
List<String>
Map<String, CaseId>
```

## 11.3 `TypeVariable`

Represents type variable:

```java
class Box<T> {}
```

`T`.

## 11.4 `WildcardType`

Represents:

```java
? extends Number
? super String
```

## 11.5 `GenericArrayType`

Represents generic array type.

## 11.6 Example

```java
Field field = User.class.getDeclaredField("names");
Type type = field.getGenericType();

if (type instanceof ParameterizedType pt) {
    Type raw = pt.getRawType();
    Type[] args = pt.getActualTypeArguments();
}
```

## 11.7 Rule

To handle generics reflectively, you need `Type`, not only `Class<?>`.

---

# 12. Type Token Pattern

To preserve generic type info, frameworks use type token.

## 12.1 Problem

```java
deserialize(json, List.class)
```

loses element type.

## 12.2 Type token

Concept:

```java
Type listOfCaseResponse = new TypeReference<List<CaseResponse>>() {}.getType();
```

Jackson/Gson have similar patterns.

## 12.3 Anonymous subclass trick

Generic superclass signature captures actual type argument.

## 12.4 Use in APIs

```java
<T> T read(String json, TypeRef<T> type)
```

## 12.5 Limitations

Still metadata-based, not runtime instance type.

## 12.6 Rule

Use type token when crossing serialization boundary with parameterized types.

---

# 13. Arrays dan Reflection

Arrays have runtime component type.

## 13.1 Check array

```java
clazz.isArray()
```

## 13.2 Component type

```java
Class<?> component = clazz.getComponentType();
```

## 13.3 Create array reflectively

```java
Object array = Array.newInstance(String.class, 10);
Array.set(array, 0, "hello");
```

## 13.4 Primitive arrays

```java
int[].class.getComponentType() == int.class
```

## 13.5 Multidimensional arrays

```java
int[][].class.getComponentType() == int[].class
```

## 13.6 Array covariance

Reflection still enforces runtime array type; wrong store can throw.

## 13.7 Rule

Arrays are reified; generics are erased. This explains many Java type system differences.

---

# 14. Enum Reflection

## 14.1 Check enum

```java
clazz.isEnum()
```

## 14.2 Constants

```java
Object[] constants = clazz.getEnumConstants();
```

## 14.3 Enum methods

```java
Enum.valueOf(Status.class, "CLOSED")
```

## 14.4 Avoid ordinal

Reflection can read ordinal, but do not persist/expose ordinal.

## 14.5 Stable code

Framework mapping should use explicit code if needed.

## 14.6 Rule

Enum reflection is useful for metadata/docs/converters, but wire/DB compatibility should not depend on enum declaration order.

---

# 15. Record Reflection

Java SE 25 `Class` exposes `isRecord()` and `getRecordComponents()`. `getRecordComponents()` returns an array of `RecordComponent` objects for record classes or null if not a record.

## 15.1 Check record

```java
if (clazz.isRecord()) {
    RecordComponent[] components = clazz.getRecordComponents();
}
```

## 15.2 RecordComponent

`RecordComponent` provides metadata about record component:

- name;
- type;
- generic type;
- accessor;
- annotations.

```java
for (RecordComponent rc : clazz.getRecordComponents()) {
    System.out.println(rc.getName());
    System.out.println(rc.getType());
    System.out.println(rc.getAccessor());
}
```

## 15.3 Canonical constructor

Frameworks can use record components to call canonical constructor.

## 15.4 Annotation target issue

Annotation may be on component, field, accessor, parameter depending target.

## 15.5 Validation/serialization

Records are reflection-friendly DTO/value objects.

## 15.6 Rule

For records, prefer record component metadata over guessing fields.

---

# 16. Sealed Type Reflection

Java SE 25 `Class` supports sealed type inspection such as `isSealed()` and `getPermittedSubclasses()`.

## 16.1 Check sealed

```java
if (clazz.isSealed()) {
    Class<?>[] permitted = clazz.getPermittedSubclasses();
}
```

## 16.2 Use cases

- generate docs/schema;
- register subtypes;
- validate closed polymorphic hierarchy;
- exhaustive framework mapping.

## 16.3 Limitations

Permitted subclass metadata tells allowed direct subclasses, not necessarily all leaf subtypes recursively.

## 16.4 Non-sealed branch

A permitted subclass can be `non-sealed`, opening hierarchy again.

## 16.5 API contract

Sealed Java hierarchy does not automatically define stable wire discriminator.

## 16.6 Rule

Use sealed reflection for metadata discovery, but still design explicit external type codes.

---

# 17. Module System dan Reflective Access

Java Platform Module System affects reflection.

## 17.1 Exports vs opens

`exports` allows compile-time/public access to package.

`opens` allows deep reflection to package at runtime.

## 17.2 Frameworks

Serialization/DI/ORM frameworks may need reflective access to non-public members.

## 17.3 Illegal reflective access

Modern Java strongly encapsulates JDK internals.

## 17.4 Module descriptor

```java
module com.example.app {
    exports com.example.api;
    opens com.example.model to com.fasterxml.jackson.databind, org.hibernate.orm.core;
}
```

## 17.5 Avoid broad open

Avoid:

```java
open module ...
```

unless framework-heavy app deliberately needs it.

## 17.6 Rule

Module openness is part of reflection contract.

---

# 18. Accessibility, Encapsulation, dan `setAccessible`

Reflection can access non-public members if access checks are suppressed, subject to module/access rules.

## 18.1 `setAccessible(true)`

```java
field.setAccessible(true);
```

Can break encapsulation.

## 18.2 InaccessibleObjectException

Strong encapsulation can prevent access even with setAccessible.

## 18.3 Security/maintainability

Deep reflection couples code to internals.

## 18.4 Prefer public API/constructor

For domain code, do not use reflection to mutate private state.

## 18.5 Framework exception

Frameworks may use deep reflection for serialization/ORM/DI, but configuration should be explicit.

## 18.6 Rule

If your application code needs `setAccessible(true)`, pause and question the design.

---

# 19. Method Invocation via Reflection

## 19.1 Invoke method

```java
Method method = service.getClass().getMethod("close", CaseId.class);
Object result = method.invoke(service, caseId);
```

## 19.2 Exceptions

If target method throws, reflection wraps it in `InvocationTargetException`.

```java
try {
    method.invoke(target);
} catch (InvocationTargetException e) {
    Throwable cause = e.getCause();
}
```

## 19.3 Type safety

Arguments checked at runtime.

## 19.4 Performance

Reflective invocation has overhead and is harder for JIT to optimize than direct call.

## 19.5 Caching

If used repeatedly, cache `Method`/metadata.

## 19.6 Rule

Use reflection invocation for framework/dynamic tooling, not ordinary business dispatch.

---

# 20. Constructor Invocation

## 20.1 Constructor

```java
Constructor<CaseId> ctor = CaseId.class.getDeclaredConstructor(String.class);
CaseId id = ctor.newInstance("CASE-000001");
```

## 20.2 No-arg constructor

Many frameworks historically required no-arg constructors.

Records do not have no-arg constructor unless components absent.

## 20.3 Constructor validation

Reflective construction still runs constructor.

For records, canonical constructor enforces invariants.

## 20.4 Exception wrapping

Constructor exception also wrapped in InvocationTargetException.

## 20.5 Accessibility

Non-public constructors may require access override/module opens.

## 20.6 Rule

Prefer explicit factories if business code needs dynamic construction.

---

# 21. Dynamic Proxies

JDK dynamic proxy creates runtime class implementing interfaces.

## 21.1 InvocationHandler

```java
interface Service {
    void run();
}

Service proxy = (Service) Proxy.newProxyInstance(
    Service.class.getClassLoader(),
    new Class<?>[]{Service.class},
    (object, method, args) -> {
        System.out.println("before");
        return method.invoke(realService, args);
    }
);
```

## 21.2 Use cases

- AOP;
- transactions;
- security;
- logging;
- RPC clients;
- lazy services.

## 21.3 Interface-based

JDK dynamic proxies implement interfaces.

Class-based proxies need bytecode generation libraries.

## 21.4 Runtime class surprise

`proxy.getClass()` is generated proxy class.

## 21.5 equals/hashCode/toString

InvocationHandler receives Object methods too; handle carefully.

## 21.6 Rule

Proxy is powerful infrastructure tool, not domain modeling tool.

---

# 22. MethodHandles

`java.lang.invoke.MethodHandles` provides low-level strongly typed references to methods/fields/constructors.

## 22.1 MethodHandle

A typed, directly executable reference to underlying method/constructor/field operation.

## 22.2 Lookup

```java
MethodHandles.Lookup lookup = MethodHandles.lookup();
MethodHandle mh = lookup.findVirtual(
    String.class,
    "substring",
    MethodType.methodType(String.class, int.class)
);
String result = (String) mh.invokeExact("hello", 1);
```

## 22.3 Access control

Lookup object carries access capability.

## 22.4 Performance

MethodHandles can be optimized better than reflection in some repeated dynamic invocation scenarios, especially when used correctly.

## 22.5 Complexity

More complex API than reflection.

## 22.6 Rule

Use MethodHandles for high-performance dynamic language/framework/infrastructure needs, not ordinary app code.

---

# 23. VarHandle

Java SE 25 `VarHandle` API describes a VarHandle as a dynamically strongly typed reference to a variable or family of variables, including static fields, non-static fields, array elements, and off-heap data structure components.

## 23.1 Field access

```java
class Counter {
    volatile int value;
}

VarHandle VH_VALUE = MethodHandles.lookup()
    .findVarHandle(Counter.class, "value", int.class);
```

## 23.2 Access modes

VarHandle supports access modes with memory ordering semantics:

- get;
- set;
- getVolatile;
- setVolatile;
- compareAndSet;
- getAndAdd;
- etc.

## 23.3 Atomic/concurrency use

Low-level building block for concurrent data structures.

## 23.4 Capability warning

OpenJDK VarHandle docs note VarHandles to non-public variables should generally be kept secret and not passed to untrusted code unless harmless.

## 23.5 Application usage

Most apps should use AtomicInteger/AtomicReference/locks/concurrent collections instead of VarHandle.

## 23.6 Rule

VarHandle is for low-level libraries and performance-sensitive infrastructure.

---

# 24. Reflection vs MethodHandle vs Direct Call

## 24.1 Direct call

```java
service.close(caseId);
```

Best for business code.

## 24.2 Reflection

```java
method.invoke(service, caseId);
```

Dynamic, easy metadata API, slower, runtime errors.

## 24.3 MethodHandle

```java
mh.invokeExact(service, caseId);
```

Dynamic but strongly typed at invocation shape; can be optimized better when stable.

## 24.4 VarHandle

Variable access with memory modes.

## 24.5 Decision

Use direct call unless you need dynamic metadata/discovery.

Use reflection for metadata/config/framework.

Use MethodHandle/VarHandle for optimized infrastructure.

## 24.6 Rule

Dynamic power should be isolated to framework/boundary code.

---

# 25. Framework Use Cases

Reflection is core to many frameworks.

## 25.1 JSON serialization

Inspect constructors, records, fields/getters, annotations.

## 25.2 ORM

Inspect entities, fields, annotations, proxies.

## 25.3 Dependency injection

Find constructors/annotations and instantiate services.

## 25.4 Validation

Read constraint annotations.

## 25.5 Testing

Discover test methods/annotations.

## 25.6 Documentation/OpenAPI

Generate schema from classes/annotations.

## 25.7 Mapping

Map DTO ↔ entity/domain with metadata.

## 25.8 Rule

Reflection in framework is normal. Reflection scattered in business code is suspicious.

---

# 26. Reflection and Serialization/Deserialization

Serialization frameworks use reflection to:

- find properties;
- access constructors;
- set fields;
- call setters;
- inspect generic types;
- read annotations;
- handle records;
- handle polymorphic types.

## 26.1 Record DTO

Framework can call canonical constructor using component names.

## 26.2 No-arg constructor

Older frameworks need no-arg constructor + setters/fields.

## 26.3 Generic type

Deserializing `List<CaseResponse>` needs generic type token.

## 26.4 Security

Polymorphic deserialization and reflective construction can be dangerous with untrusted data.

## 26.5 Contract

Do not let reflection default shape accidentally define public API.

## 26.6 Rule

Make serialization configuration explicit for public contracts.

---

# 27. Reflection and Dependency Injection

DI frameworks use reflection to find:

- constructors;
- injectable fields;
- methods;
- annotations;
- qualifiers;
- scopes.

## 27.1 Constructor injection

Best for immutable services.

```java
final class CaseService {
    private final CaseRepository repository;

    CaseService(CaseRepository repository) {
        this.repository = repository;
    }
}
```

## 27.2 Field injection

Reflection sets private fields.

Less explicit, harder testing.

## 27.3 Reflection config

AOT/native image may need metadata config.

## 27.4 Proxy

DI/AOP can create proxies.

Runtime class may differ.

## 27.5 Rule

Prefer constructor injection. Let reflection stay in framework, not domain.

---

# 28. Reflection and Validation/ORM

## 28.1 Validation

Jakarta Validation reads annotations reflectively.

## 28.2 ORM

ORM maps fields/properties to columns.

## 28.3 Field vs property access

JPA can use field access or property access.

Choose consistently.

## 28.4 Lazy proxies

Reflection/proxies can affect equals/hashCode/getClass.

## 28.5 Annotation placement

For records/fields/getters, annotation target matters.

## 28.6 Rule

Know whether framework reads fields, getters, record components, or constructor parameters.

---

# 29. Performance Considerations

## 29.1 Metadata lookup cost

Repeated scanning is expensive.

Cache metadata.

## 29.2 Invocation cost

Reflective `Method.invoke` slower than direct call.

## 29.3 Access checks

Reflection may perform access checks.

## 29.4 JIT optimization

Direct calls are easiest to inline.

Reflection is harder.

MethodHandles can be optimized if callsite stable.

## 29.5 Startup cost

Reflection scanning can slow startup.

Important for serverless/native images.

## 29.6 Rule

Reflection cost usually fine at startup/config boundary, not in hot loops.

---

# 30. Security Considerations

## 30.1 Encapsulation bypass

Reflection can access private members if allowed.

## 30.2 Untrusted class names

Never load arbitrary class from user input.

```java
Class.forName(request.className())
```

dangerous.

## 30.3 Deserialization

Reflection + polymorphic deserialization can instantiate unexpected types.

## 30.4 VarHandle capability

Do not pass powerful handles to untrusted code.

## 30.5 setAccessible

Avoid deep reflection unless trusted infrastructure.

## 30.6 Module opens

Opening packages broadly increases reflective attack surface.

## 30.7 Rule

Reflection is privileged capability. Treat metadata access and dynamic invocation as security-sensitive.

---

# 31. Reflection in Native Image/AOT Environments

AOT/native image tools often need closed-world knowledge.

Reflection is dynamic and may need configuration.

## 31.1 Problem

If class/member is only accessed reflectively, AOT may not include metadata unless configured.

## 31.2 Framework support

Modern frameworks generate reflection config or use build-time indexing.

## 31.3 Records/serialization

DTOs may need reflection metadata.

## 31.4 MethodHandles

AOT behavior depends tool/runtime.

## 31.5 Design

Prefer explicit registration/configuration for reflective needs.

## 31.6 Rule

Reflection has deployment implications beyond normal JVM.

---

# 32. Design Smells: When Reflection Should Be Avoided

## 32.1 Business dispatch by method name string

Bad:

```java
invokeByName(command.action())
```

Better:

```java
sealed interface Command
```

and exhaustive switch/handler map.

## 32.2 Accessing private fields in app code

Breaks encapsulation.

## 32.3 Reflection to avoid interface

Bad:

```java
if object has method "execute", call it
```

Better:

```java
interface Executable { void execute(); }
```

## 32.4 Reflection for mapping everywhere

Can hide errors.

For critical domain mapping, explicit mapper safer.

## 32.5 Runtime class name as type code

Bad for API/events/security.

Use stable discriminator.

## 32.6 Rule

If reflection is compensating for missing type design, redesign.

---

# 33. Type-Safe Alternatives

## 33.1 Interface

```java
interface Handler<C extends Command> {
    void handle(C command);
}
```

## 33.2 Enum strategy

```java
enum Operation {
    APPROVE { void apply(...) { ... } }
}
```

## 33.3 Sealed types

```java
sealed interface Command permits CloseCase, AssignCase {}
```

## 33.4 Visitor/pattern switch

```java
switch (command) {
    case CloseCase c -> ...
    case AssignCase a -> ...
}
```

## 33.5 Registry with Class token

```java
Map<Class<? extends Command>, Handler<?>> handlers;
```

Still uses Class metadata but controlled and type-safe-ish.

## 33.6 Code generation

Annotation processors can generate mappers/metadata at compile time.

## 33.7 Rule

Prefer compile-time structure when possible; use reflection when runtime dynamism is real.

---

# 34. Production Failure Modes

## 34.1 Reflection misses inherited annotation

Used `getDeclaredMethods` but annotation on interface/superclass.

Fix:

- define scanning policy;
- test metadata discovery.

## 34.2 Record annotation not found

Annotation targeted RECORD_COMPONENT but framework reads field/getter.

Fix:

- target correct elements;
- configure framework.

## 34.3 Generic type lost

Deserialize `List.class`, get `List<LinkedHashMap>`.

Fix:

- type token.

## 34.4 Module access failure

Works on classpath, fails on module path.

Fix:

- `opens` package to framework;
- avoid deep reflection.

## 34.5 Native image missing reflection config

Works on JVM, fails in native image.

Fix:

- register reflection metadata;
- use framework AOT support.

## 34.6 Proxy class equality bug

Entity equality uses `getClass()` and fails with proxy.

Fix:

- ORM-aware equality strategy.

## 34.7 Reflection in hot loop

Latency/CPU issue.

Fix:

- cache method handles/metadata;
- direct call;
- generated code.

## 34.8 InvocationTargetException swallowed

Root cause hidden.

Fix:

- unwrap and propagate/log cause.

## 34.9 setAccessible breaks after JDK upgrade

Strong encapsulation blocks internal access.

Fix:

- public API;
- module opens;
- stop relying on internals.

## 34.10 User-controlled class loading

Security vulnerability.

Fix:

- allowlist;
- no arbitrary Class.forName.

## 34.11 Polymorphic type uses class name

API consumer tied to Java package; security risk.

Fix:

- stable logical type discriminator.

## 34.12 Reflection-based mapper ignores invariants

Sets fields directly, bypasses constructor.

Fix:

- constructor-based mapping;
- domain factory;
- validation after mapping.

---

# 35. Best Practices

## 35.1 General

- Keep reflection at boundaries/framework infrastructure.
- Prefer direct calls/interfaces/sealed types in domain.
- Cache reflection metadata.
- Use type tokens for parameterized generic types.
- Use record component metadata for records.
- Use sealed metadata carefully; still design explicit external type codes.
- Avoid `setAccessible` in application code.
- Understand module `opens`.
- Do not load classes from untrusted input.
- Unwrap `InvocationTargetException`.
- Test reflection code across JDK/module/AOT environments.
- Make annotation targets explicit.
- Avoid reflection in hot loops unless measured and optimized.
- Use MethodHandles/VarHandle only where justified.

## 35.2 Framework integration

- Configure serialization explicitly.
- Prefer constructor injection.
- Do not expose domain internals for framework convenience.
- Keep DTOs separate from entities when needed.
- Verify reflection scanning with tests.

## 35.3 Security

- Treat reflection as privileged capability.
- Whitelist classes/subtypes.
- Avoid class-name type discriminators in external payload.
- Keep handles private.
- Use module boundaries deliberately.

---

# 36. Decision Matrix

| Need | Recommended |
|---|---|
| inspect class metadata | Reflection `Class`, `Field`, `Method` |
| inspect record DTO | `isRecord`, `getRecordComponents` |
| inspect sealed hierarchy | `isSealed`, `getPermittedSubclasses` |
| deserialize `List<T>` | type token / `Type` |
| dynamic high-performance invocation | MethodHandle |
| low-level atomic field access | VarHandle or atomic classes |
| business command dispatch | sealed types/handler registry, not method-name reflection |
| framework object construction | constructor reflection with validation |
| dependency injection | constructor injection, framework reflection |
| native image | explicit reflection config/AOT support |
| public API polymorphism | logical discriminator, not class name |
| private field access in app code | avoid/redesign |
| repeated reflection | cache metadata |
| enum metadata | enum constants + stable code |
| ORM entity equality with proxies | proxy-aware strategy |

---

# 37. Latihan

## Latihan 1 — Class Metadata

Write utility that prints class name, module, superclass, interfaces, modifiers.

## Latihan 2 — Record Introspection

Given a record DTO, print record components, types, accessor names, annotations.

## Latihan 3 — Sealed Introspection

Given sealed interface, list permitted direct subclasses. Then handle non-sealed branch.

## Latihan 4 — Generic Field Type

Reflect a field `List<CaseId> caseIds` and inspect `ParameterizedType`.

## Latihan 5 — Type Token

Implement small `TypeRef<T>` capturing generic type via anonymous subclass.

## Latihan 6 — Annotation Scanner

Create `@CommandHandler` annotation and scan declared methods. Decide inherited behavior.

## Latihan 7 — Dynamic Proxy

Create proxy for interface that logs before/after method call. Handle `toString`.

## Latihan 8 — MethodHandle

Use MethodHandle to call `String.substring(int)`.

## Latihan 9 — VarHandle

Create VarHandle for a volatile int field and use compareAndSet.

## Latihan 10 — Reflection Failure

Invoke method that throws exception reflectively and unwrap InvocationTargetException.

## Latihan 11 — Module Opens

Create simple module and observe reflective access failure/success with `opens`.

## Latihan 12 — Reflection vs Type Design

Replace string-based reflective command dispatch with sealed command + handler map.

---

# 38. Ringkasan

Reflection gives Java runtime introspection power.

It lets code inspect and operate on:

```text
classes
fields
methods
constructors
annotations
generic signatures
records
sealed types
arrays
enums
modules
```

Key lessons:

- `Class<?>` is runtime type token.
- Runtime class can differ from static type.
- Generics are erased, but declarations may retain generic signature metadata.
- `Class<T>` is insufficient for `List<T>`; use `Type`.
- Records should be inspected via record components.
- Sealed metadata helps framework discovery but does not replace API discriminator design.
- Reflection bypasses compile-time safety.
- `setAccessible` breaks encapsulation and can fail with modules.
- MethodHandles/VarHandle are lower-level, more capability-oriented tools.
- Reflection is normal in frameworks but suspicious in core domain code.
- Reflection impacts performance, security, AOT/native image, and maintainability.
- Prefer type-safe alternatives where possible.

Senior Java engineer does not think:

```text
Reflection is bad.
```

They think:

```text
Reflection belongs at the dynamic boundary.
The domain should stay typed.
Metadata should be cached.
Access should be explicit.
Security should be reviewed.
AOT/module implications should be known.
```

Reflection is a sharp tool: essential for frameworks, dangerous as a shortcut for weak type design.

---

# 39. Referensi

1. Java SE 25 API — `Class`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Class.html

2. Java SE 25 API — `java.lang.reflect` package summary  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/package-summary.html

3. Java SE 25 API — `RecordComponent`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/RecordComponent.html

4. Java SE 25 API — `Method`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/Method.html

5. Java SE 25 API — `Field`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/Field.html

6. Java SE 25 API — `Constructor`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/Constructor.html

7. Java SE 25 API — `Proxy`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/Proxy.html

8. Java SE 25 API — `MethodHandles`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodHandles.html

9. Java SE 25 API — `VarHandle`  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/VarHandle.html

10. Java SE 25 API — `Type`  
    https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/reflect/Type.html
