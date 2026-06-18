# learn-java-jakarta-part-027.md

# Bagian 27 — Jakarta Expression Language (`jakarta.el`): Expression Evaluation, Resolver Chain, Coercion, Method Expression, dan Security

> Target pembaca: Java engineer yang ingin memahami Jakarta Expression Language / EL bukan hanya `#{bean.name}`, tetapi sebagai **runtime expression evaluation engine** yang dipakai oleh Jakarta Faces, Jakarta Pages/JSP, CDI, Bean Validation/message interpolation contexts, dan berbagai framework Jakarta EE.
>
> Fokus bagian ini: Jakarta Expression Language 6.0 di Jakarta EE 11, immediate vs deferred expressions, value expression vs method expression, rvalue/lvalue, resolver chain, `ELContext`, `ExpressionFactory`, `ValueExpression`, `MethodExpression`, `ELResolver`, `ELProcessor`, type coercion, functions, imports, lambdas, collections, operators, integration dengan Faces/CDI/JSP, standalone evaluation, performance, security, injection risks, and production failure modes.

---

## Daftar Isi

1. [Orientasi: EL Itu Bukan Sekadar Syntax `#{...}`](#1-orientasi-el-itu-bukan-sekadar-syntax-)
2. [Mental Model: Expression → Context → Resolver Chain → Value/Method](#2-mental-model-expression--context--resolver-chain--valuemethod)
3. [Jakarta Expression Language 6.0 dalam Jakarta EE 11](#3-jakarta-expression-language-60-dalam-jakarta-ee-11)
4. [EL Digunakan di Mana Saja?](#4-el-digunakan-di-mana-saja)
5. [Dependency, Runtime, dan Standalone Use](#5-dependency-runtime-dan-standalone-use)
6. [Peta API `jakarta.el`](#6-peta-api-jakartael)
7. [Immediate Expression `${...}` vs Deferred Expression `#{...}`](#7-immediate-expression--vs-deferred-expression-)
8. [Value Expression vs Method Expression](#8-value-expression-vs-method-expression)
9. [Rvalue dan Lvalue](#9-rvalue-dan-lvalue)
10. [`ELContext`: Runtime Evaluation Context](#10-elcontext-runtime-evaluation-context)
11. [`ExpressionFactory`: Membuat Expression Object](#11-expressionfactory-membuat-expression-object)
12. [`ValueExpression`: Read/Write Value](#12-valueexpression-readwrite-value)
13. [`MethodExpression`: Invoke Method](#13-methodexpression-invoke-method)
14. [`ELResolver`: Resolver Chain adalah Inti EL](#14-elresolver-resolver-chain-adalah-inti-el)
15. [Standard Resolvers: Bean, Map, List, Array, ResourceBundle, StaticField](#15-standard-resolvers-bean-map-list-array-resourcebundle-staticfield)
16. [VariableMapper dan FunctionMapper](#16-variablemapper-dan-functionmapper)
17. [Operators dan Syntax Dasar](#17-operators-dan-syntax-dasar)
18. [Property Access: Dot vs Bracket](#18-property-access-dot-vs-bracket)
19. [Method Invocation dan Parameter](#19-method-invocation-dan-parameter)
20. [Type Coercion: String, Number, Boolean, Enum, Null](#20-type-coercion-string-number-boolean-enum-null)
21. [Collections, Projection, Selection, Lambda, dan Stream-like Features](#21-collections-projection-selection-lambda-dan-stream-like-features)
22. [`ELProcessor`: Standalone Expression Evaluation](#22-elprocessor-standalone-expression-evaluation)
23. [Imports, Static Fields, dan Static Methods](#23-imports-static-fields-dan-static-methods)
24. [Functions: Bind Java Static Method ke EL](#24-functions-bind-java-static-method-ke-el)
25. [Integration dengan Jakarta Faces](#25-integration-dengan-jakarta-faces)
26. [Integration dengan Jakarta Pages / JSP](#26-integration-dengan-jakarta-pages--jsp)
27. [Integration dengan CDI](#27-integration-dengan-cdi)
28. [Integration dengan Bean Validation dan Message Interpolation](#28-integration-dengan-bean-validation-dan-message-interpolation)
29. [Custom ELResolver](#29-custom-elresolver)
30. [Custom Function dan Domain DSL](#30-custom-function-dan-domain-dsl)
31. [Expression Caching dan Performance](#31-expression-caching-dan-performance)
32. [Security: EL Injection dan Dynamic Evaluation Risk](#32-security-el-injection-dan-dynamic-evaluation-risk)
33. [Sandboxing dan Restricting Expressions](#33-sandboxing-dan-restricting-expressions)
34. [Error Handling dan Debugging](#34-error-handling-dan-debugging)
35. [Testing Strategy](#35-testing-strategy)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices dan Anti-Patterns](#37-best-practices-dan-anti-patterns)
38. [Checklist Review](#38-checklist-review)
39. [Case Study 1: Faces Form Binding `#{userForm.email}`](#39-case-study-1-faces-form-binding-userformemail)
40. [Case Study 2: Dynamic Rule Engine yang Berbahaya](#40-case-study-2-dynamic-rule-engine-yang-berbahaya)
41. [Case Study 3: Resolver Chain Membaca Map, Bukan Bean](#41-case-study-3-resolver-chain-membaca-map-bukan-bean)
42. [Case Study 4: Performance Drop karena Expression Diparse Berulang](#42-case-study-4-performance-drop-karena-expression-diparse-berulang)
43. [Latihan Bertahap](#43-latihan-bertahap)
44. [Mini Project: Jakarta EL Evaluation Lab](#44-mini-project-jakarta-el-evaluation-lab)
45. [Referensi Resmi](#45-referensi-resmi)

---

# 1. Orientasi: EL Itu Bukan Sekadar Syntax `#{...}`

Di Jakarta Faces, kamu sering menulis:

```xml
<h:inputText value="#{userForm.email}" />
<h:commandButton action="#{userForm.save}" />
```

Di JSP/Jakarta Pages, kamu mungkin menulis:

```jsp
${sessionScope.user.name}
```

Banyak developer menganggap EL hanyalah “shortcut untuk getter”.

Padahal EL adalah expression language dengan runtime engine sendiri.

EL bisa:

- membaca property;
- menulis property;
- memanggil method;
- memanggil function;
- melakukan coercion type;
- mengakses map/list/array/bean;
- evaluate operator;
- resolve variable dari scope/context;
- digunakan deferred dalam lifecycle;
- dibuat dan dievaluasi standalone;
- di-extend dengan custom resolver.

## 1.1 Kenapa EL penting?

Karena EL adalah glue antara presentation layer dan application logic.

Dalam Faces:

```text
XHTML component value → EL expression → backing bean property
```

Dalam JSP:

```text
template output → EL expression → request/session/application attribute
```

Dalam custom framework:

```text
config expression → EL engine → runtime decision
```

Jika tidak paham, bug bisa terlihat seperti:

- property tidak terbaca;
- action tidak terpanggil;
- setter tidak dipanggil;
- type conversion aneh;
- method overload salah;
- resolver salah resolve object;
- security leak;
- expression injection;
- performance buruk.

## 1.2 EL bukan Java

EL mirip Java dalam beberapa operator, tetapi bukan Java.

Contoh:

```text
empty user.name
user.active ? 'yes' : 'no'
order.total gt 100
bean.method(param)
```

Ia punya coercion dan resolver behavior sendiri.

## 1.3 EL bukan scripting bebas

EL dirancang sebagai expression language, bukan full programming language.

Namun fitur modern seperti method invocation, lambda, collections, dan static access membuatnya cukup powerful—dan karena itu perlu governance.

## 1.4 Prinsip utama

```text
Expression evaluation is code execution with a different syntax.
```

Jangan evaluate expression dari user input tanpa kontrol.

---

# 2. Mental Model: Expression → Context → Resolver Chain → Value/Method

Mental model EL:

```text
Expression string
  ↓ parse
Expression object
  ↓ evaluate with ELContext
ELResolver chain
  ↓ resolve variable/property/method
coerce type
  ↓
return value / invoke method / set value
```

## 2.1 Expression string

Contoh:

```text
#{userForm.email}
${sessionScope.user.name}
#{orderService.approve(order.id)}
```

## 2.2 Expression object

Expression string diparse menjadi object:

- `ValueExpression`;
- `MethodExpression`.

## 2.3 ELContext

`ELContext` menyimpan environment evaluasi:

- resolver;
- function mapper;
- variable mapper;
- locale/context data;
- propertyResolved flag.

## 2.4 Resolver chain

EL tidak langsung tahu `userForm` itu apa.

Ia bertanya ke resolver chain:

```text
Can you resolve base=null, property=userForm?
```

Jika ketemu, lanjut:

```text
Can you resolve base=userFormObject, property=email?
```

## 2.5 Type coercion

Jika target type `Integer` tapi expression menghasilkan `"123"`, EL bisa coerce.

## 2.6 Deferred evaluation

Di Faces, `#{bean.value}` tidak selalu dievaluasi saat page dibaca.

Ia bisa dievaluasi di phase tertentu.

## 2.7 Why this mental model matters

Jika expression tidak bekerja, pertanyaan debugging:

1. Expression diparse sebagai value atau method?
2. ELContext apa yang dipakai?
3. Resolver mana yang resolve variable?
4. Base object apa?
5. Property apa?
6. Getter/setter ada?
7. Type target apa?
8. Coercion berhasil?
9. Exception di-resolve atau ditelan framework?
10. Apakah expression immediate atau deferred?

---

# 3. Jakarta Expression Language 6.0 dalam Jakarta EE 11

Jakarta Expression Language 6.0 adalah release untuk Jakarta EE 11.

Spesifikasi ini mendefinisikan expression language untuk Java applications.

## 3.1 Release highlights

EL 6.0:

- release untuk Jakarta EE 11;
- membuat dependency ke `java.desktop` module optional;
- menghapus referensi SecurityManager;
- menyediakan usability improvements.

## 3.2 Package utama

```java
jakarta.el
```

## 3.3 EL 6.1

EL 6.1 under development untuk Jakarta EE 12.

Target kita: Jakarta EE 11 / EL 6.0.

## 3.4 API docs

API `jakarta.el` menyediakan classes untuk:

- expression creation;
- expression evaluation;
- resolvers;
- standalone evaluation via `ELProcessor`;
- functions;
- imports;
- method/value expressions.

## 3.5 Jakarta EE 11

Jakarta EE 11 Web Profile mencantumkan Expression Language 6.0 bersama Servlet, Pages, Faces, CDI, Validation, dan WebSocket.

---

# 4. EL Digunakan di Mana Saja?

## 4.1 Jakarta Faces

Faces heavily uses EL:

```xml
<h:inputText value="#{userForm.email}" />
<h:commandButton action="#{userForm.save}" />
```

## 4.2 Jakarta Pages / JSP

JSP uses EL:

```jsp
${requestScope.user.name}
```

## 4.3 CDI integration

EL can resolve CDI named beans:

```java
@Named("userForm")
```

then:

```text
#{userForm}
```

## 4.4 Jakarta Security / config usage

Some Jakarta specs/frameworks allow expression-based config or annotations.

## 4.5 Standalone usage

EL can be used outside web tier via `ELProcessor`.

```java
ELProcessor el = new ELProcessor();
Object result = el.eval("1 + 2");
```

## 4.6 Template-like systems

Some internal systems use EL for dynamic expressions.

Be careful: this can become unsafe rule engine if uncontrolled.

## 4.7 Not for arbitrary business logic

EL is good glue, not replacement for domain code.

---

# 5. Dependency, Runtime, dan Standalone Use

## 5.1 Maven API dependency

```xml
<dependency>
  <groupId>jakarta.el</groupId>
  <artifactId>jakarta.el-api</artifactId>
  <version>6.0.0</version>
  <scope>provided</scope>
</dependency>
```

In Jakarta EE runtime, API/implementation may be provided.

## 5.2 Implementation

API jar is not enough for standalone evaluation.

You need implementation, often provided by:

- application server;
- Servlet container;
- EL implementation library.

Common implementation in many environments is Apache EL/Tomcat EL or GlassFish/Jakarta implementation variants.

## 5.3 In Jakarta EE app

Usually you do not instantiate EL engine manually for Faces/JSP.

Framework/runtime handles it.

## 5.4 Standalone app

Use `ELProcessor` or implementation-specific setup.

## 5.5 Avoid duplicate API jars

If app server provides EL API, bundling incompatible API/impl can cause classloading issues.

## 5.6 Namespace migration

Old:

```java
javax.el
```

New:

```java
jakarta.el
```

## 5.7 Jakarta Pages/Faces integration

EL version is usually aligned with runtime's web profile.

---

# 6. Peta API `jakarta.el`

Important types:

```text
ELProcessor
ELManager
ELContext
ExpressionFactory
Expression
ValueExpression
MethodExpression
ELResolver
CompositeELResolver
BeanELResolver
MapELResolver
ListELResolver
ArrayELResolver
ResourceBundleELResolver
StaticFieldELResolver
FunctionMapper
VariableMapper
ImportHandler
LambdaExpression
ValueReference
MethodInfo
MethodReference
ELException
PropertyNotFoundException
PropertyNotWritableException
MethodNotFoundException
```

## 6.1 `ELProcessor`

Simple standalone expression evaluation.

## 6.2 `ELManager`

Manages EL environment, imports, beans, resolvers.

## 6.3 `ExpressionFactory`

Creates expressions.

## 6.4 `ValueExpression`

Represents expression that reads/writes values.

## 6.5 `MethodExpression`

Represents expression that invokes method.

## 6.6 `ELResolver`

Resolves variables/properties/methods.

## 6.7 `CompositeELResolver`

Chains multiple resolvers.

## 6.8 `FunctionMapper`

Maps EL function names to Java methods.

## 6.9 `VariableMapper`

Maps variables to value expressions.

## 6.10 `ImportHandler`

Handles imported classes/packages/static members.

---

# 7. Immediate Expression `${...}` vs Deferred Expression `#{...}`

EL has two major delimiter styles:

```text
${...}
#{...}
```

## 7.1 Immediate expression `${...}`

Immediate expressions are evaluated immediately.

Common in JSP output:

```jsp
${user.name}
```

## 7.2 Deferred expression `#{...}`

Deferred expressions can be evaluated later.

Common in Faces:

```xml
<h:inputText value="#{userForm.email}" />
```

## 7.3 Key distinction

`${...}`:

```text
evaluate now
```

`#{...}`:

```text
can be evaluated later by framework lifecycle
```

## 7.4 Lvalue support

Deferred expressions can act as lvalue.

Example:

```xml
<h:inputText value="#{userForm.email}" />
```

Faces can:

```text
read userForm.email during render
write userForm.email during update model values
```

## 7.5 Immediate expressions and assignment

Immediate expression may be rvalue but not assigned during lifecycle in the same way.

## 7.6 Faces heavily uses deferred

Because Faces lifecycle needs read/write at different phases.

## 7.7 Debugging rule

If expression is in Faces component attribute like `value` or `action`, think `#{...}`.

If expression is simple JSP output, think `${...}`.

---

# 8. Value Expression vs Method Expression

## 8.1 Value expression

Expression that resolves to a value/property.

Examples:

```text
#{user.name}
#{order.total}
#{cart.items[0]}
${sessionScope.user}
```

Can be read, sometimes written.

## 8.2 Method expression

Expression that invokes method.

Examples:

```text
#{userForm.save}
#{orderService.approve(order.id)}
#{bean.calculate(1, 2)}
```

## 8.3 Faces examples

Value:

```xml
<h:inputText value="#{form.email}" />
```

Method:

```xml
<h:commandButton action="#{form.save}" />
```

## 8.4 Type metadata

`MethodExpression` can provide `MethodInfo`.

`ValueExpression` can provide type/value reference.

## 8.5 Common bug

Using method expression where value expression expected or vice versa.

Example:

```xml
<h:outputText value="#{bean.doSomething}" />
```

May resolve method reference differently than intended.

## 8.6 Method with parentheses

Depending usage, method can be invoked with:

```text
#{bean.save()}
```

or method expression reference:

```text
#{bean.save}
```

Faces action attributes often accept method expression without parentheses.

## 8.7 Overloading

Method overload resolution can be tricky with EL coercion.

Avoid ambiguous overloaded methods exposed to EL.

---

# 9. Rvalue dan Lvalue

## 9.1 Rvalue

Expression can be read.

Example:

```text
#{user.name}
```

returns name.

## 9.2 Lvalue

Expression can be assigned.

Example:

```text
#{userForm.email}
```

Faces input can set it.

## 9.3 Not all expressions writable

Read-only:

```text
#{user.fullName}
```

if only getter exists.

Computed expression:

```text
#{user.firstName + ' ' + user.lastName}
```

not writable.

## 9.4 Setter required

For bean property to be writable:

```java
public String getEmail()
public void setEmail(String email)
```

## 9.5 Map/list writable

Maps/lists can be writable depending resolver/object mutability.

```text
#{map['key']}
#{list[0]}
```

## 9.6 Faces model update

During Update Model Values, Faces calls `ValueExpression.setValue(...)`.

## 9.7 Common bug

Input bound to property with no setter:

```text
PropertyNotWritableException
```

or update fails.

---

# 10. `ELContext`: Runtime Evaluation Context

`ELContext` is context object for expression evaluation.

## 10.1 What it contains

- `ELResolver`;
- `FunctionMapper`;
- `VariableMapper`;
- context objects;
- locale;
- property resolved flag.

## 10.2 Resolver access

```java
ELResolver resolver = elContext.getELResolver();
```

## 10.3 `propertyResolved`

Resolvers use flag to indicate they resolved property.

```java
context.setPropertyResolved(true);
```

## 10.4 Why important?

Composite resolver chain stops when a resolver says property is resolved.

## 10.5 Context object storage

ELContext can store context-specific objects keyed by class.

## 10.6 Framework-provided context

Faces/JSP/CDI provide their own ELContext with resolver chain and scope integrations.

## 10.7 Standalone context

Standalone usage through `ELProcessor` hides much of setup.

## 10.8 Thread safety

ELContext is evaluation-specific. Do not share mutable context across threads casually.

---

# 11. `ExpressionFactory`: Membuat Expression Object

`ExpressionFactory` creates `ValueExpression` and `MethodExpression`.

## 11.1 Create value expression

```java
ExpressionFactory factory = ExpressionFactory.newInstance();

ValueExpression expr = factory.createValueExpression(
    elContext,
    "#{user.name}",
    String.class
);
```

## 11.2 Evaluate

```java
String name = (String) expr.getValue(elContext);
```

## 11.3 Set value

```java
expr.setValue(elContext, "Fajar");
```

if writable.

## 11.4 Create method expression

```java
MethodExpression method = factory.createMethodExpression(
    elContext,
    "#{userService.findById}",
    User.class,
    new Class<?>[] { Long.class }
);
```

## 11.5 Invoke

```java
User user = (User) method.invoke(elContext, new Object[] { 1L });
```

## 11.6 Cache expression object

Parsing expression has cost.

If repeatedly evaluating same expression, cache parsed expression safely with correct context assumptions.

## 11.7 Do not cache ELContext globally

Cache expression, not request-specific ELContext.

---

# 12. `ValueExpression`: Read/Write Value

`ValueExpression` represents expression that evaluates to value.

## 12.1 Read

```java
Object value = expr.getValue(elContext);
```

## 12.2 Write

```java
expr.setValue(elContext, newValue);
```

## 12.3 Type

```java
Class<?> type = expr.getType(elContext);
```

## 12.4 Expected type

When created, expected type affects coercion.

```java
createValueExpression(context, "#{param.age}", Integer.class)
```

## 12.5 Value reference

Some API supports retrieving base/property reference for expression.

Useful for tooling/debugging.

## 12.6 Read-only

```java
expr.isReadOnly(elContext)
```

## 12.7 Literal expression

Expression can be literal text.

## 12.8 Composite expression

Text can contain expressions:

```text
Hello #{user.name}
```

depending parser/use context.

---

# 13. `MethodExpression`: Invoke Method

`MethodExpression` represents method invocation.

## 13.1 Method metadata

```java
MethodInfo info = expr.getMethodInfo(elContext);
```

## 13.2 Invoke

```java
Object result = expr.invoke(elContext, params);
```

## 13.3 Faces action

```xml
<h:commandButton action="#{bean.save}" />
```

Faces invokes method during Invoke Application phase.

## 13.4 Method parameters

Modern EL supports method invocation with parameters in expressions.

```text
#{orderService.approve(order.id)}
```

## 13.5 Overload resolution

EL chooses method based on name/parameter types/coercion.

Avoid ambiguous overloads for EL-exposed beans.

## 13.6 Return coercion

Expected return type can influence coercion.

## 13.7 Exceptions

Invocation can throw wrapped exceptions.

Handle and unwrap carefully when debugging.

---

# 14. `ELResolver`: Resolver Chain adalah Inti EL

`ELResolver` is how EL resolves variables/properties.

## 14.1 Method signatures

Conceptually:

```java
getValue(context, base, property)
setValue(context, base, property, value)
getType(context, base, property)
isReadOnly(context, base, property)
invoke(context, base, method, paramTypes, params)
```

## 14.2 Base null

When resolving top-level variable:

```text
#{user}
```

base is null, property is `"user"`.

## 14.3 Base non-null

When resolving property:

```text
#{user.name}
```

first `user` resolves to object, then base is user object, property is `"name"`.

## 14.4 Composite resolver

A `CompositeELResolver` calls resolvers in order.

## 14.5 propertyResolved flag

Resolver must set flag if it resolves.

If not, next resolver is tried.

## 14.6 Resolver order matters

If map resolver runs before bean resolver and base is Map, map key wins.

## 14.7 Custom resolver risk

Custom resolver can shadow variables/properties unexpectedly.

## 14.8 Debugging resolver

When expression resolves wrong value, inspect resolver order and base object type.

---

# 15. Standard Resolvers: Bean, Map, List, Array, ResourceBundle, StaticField

## 15.1 BeanELResolver

Resolves JavaBean properties.

```text
#{user.name}
```

calls:

```java
user.getName()
```

or setter for write.

## 15.2 MapELResolver

Resolves map keys.

```text
#{map['name']}
```

or sometimes:

```text
#{map.name}
```

if property is key.

## 15.3 ListELResolver

Resolves list index.

```text
#{items[0]}
```

## 15.4 ArrayELResolver

Resolves array index.

```text
#{array[0]}
```

## 15.5 ResourceBundleELResolver

Resolves resource bundle keys.

```text
#{msg['label.name']}
```

## 15.6 StaticFieldELResolver

Resolves static fields when static access/import enabled.

## 15.7 Scoped attribute resolvers

JSP/Faces add resolvers for:

- request scope;
- session scope;
- application scope;
- CDI named beans;
- implicit objects.

## 15.8 Common ambiguity

```text
#{user.name}
```

could mean:

- CDI bean `user` property `name`;
- request attribute `user`;
- map key;
- session attribute.

Resolver order determines.

---

# 16. VariableMapper dan FunctionMapper

## 16.1 VariableMapper

Maps variable name to ValueExpression.

Useful in tag files, Facelets, standalone.

Example concept:

```java
variableMapper.setVariable("x", expression);
```

## 16.2 FunctionMapper

Maps EL function to Java static method.

Example:

```text
#{fn:length(items)}
```

or custom namespace.

## 16.3 Variable vs resolver

VariableMapper is different from ELResolver.

VariableMapper maps lexical variable names directly to expressions.

ELResolver resolves variables/properties dynamically.

## 16.4 Scope

VariableMapper is usually tied to parsing/evaluation context.

## 16.5 Use carefully

Too many mapped variables can make expressions harder to reason about.

## 16.6 Function security

Only expose safe static methods.

---

# 17. Operators dan Syntax Dasar

## 17.1 Arithmetic

```text
${1 + 2}
${price * quantity}
${total / 100}
${total mod 10}
```

## 17.2 Comparison

```text
${age > 18}
${age gt 18}
${name == 'Fajar'}
${name eq 'Fajar'}
${status != 'CLOSED'}
${status ne 'CLOSED'}
```

## 17.3 Logical

```text
${active and verified}
${admin or owner}
${not empty items}
```

## 17.4 Empty

```text
${empty user.name}
${not empty orders}
```

`empty` checks null/empty string/empty collection/map/array depending rules.

## 17.5 Conditional

```text
${user.active ? 'Active' : 'Inactive'}
```

## 17.6 String concatenation

EL supports string concatenation depending version/operator support.

Often:

```text
${user.firstName.concat(' ').concat(user.lastName)}
```

or newer syntax.

## 17.7 Parentheses

```text
${(a + b) * c}
```

## 17.8 Precedence

Know operator precedence or use parentheses.

## 17.9 Null behavior

EL null handling/coercion can differ from Java.

Test important expressions.

---

# 18. Property Access: Dot vs Bracket

## 18.1 Dot notation

```text
#{user.name}
```

Equivalent to property access.

## 18.2 Bracket notation

```text
#{user['name']}
```

Useful when property/key dynamic.

## 18.3 Dynamic key

```text
#{map[bean.selectedKey]}
```

## 18.4 Map access

```text
#{headers['User-Agent']}
```

Cannot use dot if key has hyphen.

## 18.5 List index

```text
#{items[0]}
```

## 18.6 Array index

```text
#{array[0]}
```

## 18.7 Dot can resolve map key

If base is Map:

```text
#{map.name}
```

can look up key `"name"`.

## 18.8 Best practice

Use bracket notation for maps with external/dynamic keys.

Use dot for bean properties.

---

# 19. Method Invocation dan Parameter

## 19.1 No-arg method

```text
#{bean.save()}
```

or method expression:

```text
#{bean.save}
```

depending attribute.

## 19.2 With parameter

```text
#{orderService.approve(order.id)}
```

## 19.3 Method in Faces action

```xml
<h:commandButton action="#{orderForm.approve(order.id)}" />
```

## 19.4 Avoid heavy logic in EL

Bad:

```xml
rendered="#{orderService.expensiveCheck(order.id)}"
```

because render can call repeatedly.

Better:

```java
form.canApprove(order)
```

computed/cached in backing bean.

## 19.5 Method overload

Avoid:

```java
find(String id)
find(Long id)
```

when called from EL with ambiguous parameter.

## 19.6 Side effects in getters/methods

EL may evaluate expressions multiple times.

Do not put side effects in getters or render-time methods.

## 19.7 Security

Do not expose powerful service methods to expressions built from user input.

---

# 20. Type Coercion: String, Number, Boolean, Enum, Null

EL performs type coercion depending expected type/operator.

## 20.1 String to number

```text
"123" → Integer/Long/BigDecimal
```

depending expected type.

## 20.2 String to boolean

```text
"true" → Boolean.TRUE
```

## 20.3 Number conversion

Integer/Long/Double/BigDecimal conversions follow EL coercion rules.

## 20.4 Enum

String may be coerced to enum constant when target type known.

## 20.5 Null and empty string

Null/empty coercion can surprise.

Example:

```text
"" to number
"" to null
null to false
```

behavior depends target/operator/spec rules.

Test.

## 20.6 Faces input

Faces conversion may happen through Faces converter before model update, not only generic EL coercion.

## 20.7 Expected type matters

When creating `ValueExpression`, expected type influences result.

## 20.8 Avoid relying on clever coercion

Be explicit in critical code.

---

# 21. Collections, Projection, Selection, Lambda, dan Stream-like Features

Modern EL includes richer collection/lambda-style features inherited from later EL versions.

## 21.1 Lambda expression

Conceptually:

```text
x -> x + 1
```

## 21.2 Collection operation examples

Depending version/support, EL can express operations over collections such as filtering/mapping.

## 21.3 Use cases

- simple view filtering;
- formatting;
- conditional display.

## 21.4 Caution

Do not move complex business/query logic into EL.

Bad:

```xml
#{orders.stream().filter(o -> o.total > 1000).map(...).toList()}
```

especially if evaluated during render repeatedly.

## 21.5 Performance

Collection expressions can be expensive in large views.

## 21.6 Readability

Complex EL is hard to debug.

Prefer backing bean method/property for non-trivial logic.

## 21.7 Security

If user can influence collection expression, risk rises.

---

# 22. `ELProcessor`: Standalone Expression Evaluation

`ELProcessor` provides simple API for direct evaluation of expressions in standalone environment.

## 22.1 Basic use

```java
ELProcessor el = new ELProcessor();
Object result = el.eval("1 + 2");
```

## 22.2 Define bean

```java
el.defineBean("user", new User("Fajar"));
String name = (String) el.eval("user.name");
```

## 22.3 Set variable

```java
el.setValue("x", 10);
Object result = el.eval("x * 2");
```

## 22.4 Define function

```java
el.defineFunction("math", "max", Math.class.getMethod("max", int.class, int.class));
Object result = el.eval("math:max(1, 2)");
```

## 22.5 Import class

```java
el.getELManager().importClass("java.time.LocalDate");
Object today = el.eval("LocalDate.now()");
```

## 22.6 Use cases

- dynamic rule prototype;
- admin-configurable expressions;
- testing expressions;
- framework internals.

## 22.7 Security warning

Do not evaluate untrusted user expression with unrestricted `ELProcessor`.

It may access methods/classes you did not intend.

## 22.8 Performance

Cache expressions if repeated.

---

# 23. Imports, Static Fields, dan Static Methods

## 23.1 ImportHandler

EL supports import handling for classes/packages/static members.

## 23.2 Class import

```java
el.getELManager().importClass("java.time.LocalDate");
```

Then:

```text
LocalDate.now()
```

## 23.3 Static field

Static field access can expose constants.

## 23.4 Static method

Static method invocation can be useful but dangerous.

## 23.5 Security risk

If arbitrary class import/static method access is allowed, attacker may access dangerous APIs depending implementation restrictions.

## 23.6 Restrict

If using EL for business/admin rules:

- allowlist classes/functions;
- avoid arbitrary import;
- custom resolver;
- sandbox evaluator;
- no user-provided raw expressions unless trusted.

## 23.7 Readability

Static calls inside view are usually bad style.

Move logic to backing bean/service.

---

# 24. Functions: Bind Java Static Method ke EL

EL functions map prefix/name to Java static methods.

## 24.1 Use case

Utility functions in views.

Example:

```text
#{my:maskEmail(user.email)}
```

## 24.2 Static method

```java
public final class EmailFunctions {
    public static String maskEmail(String email) {
        ...
    }
}
```

## 24.3 Function mapping

In JSP taglib/Facelets function library, functions can be declared.

Standalone via `ELProcessor.defineFunction`.

## 24.4 Good functions

- formatting;
- masking;
- simple pure utilities.

## 24.5 Bad functions

- DB access;
- external API calls;
- state mutation;
- security-sensitive operations.

## 24.6 Function purity

Functions called in render should be pure and cheap.

## 24.7 Avoid business logic in function

Business rules belong in Java service/domain.

---

# 25. Integration dengan Jakarta Faces

Faces is one of the biggest EL users.

## 25.1 Value binding

```xml
<h:inputText value="#{userForm.email}" />
```

Faces uses expression to:

- read value during render;
- write value during Update Model Values.

## 25.2 Method binding

```xml
<h:commandButton action="#{userForm.save}" />
```

Faces invokes method in Invoke Application phase.

## 25.3 Validator/converter attributes

```xml
<f:validator binding="#{bean.validator}" />
```

or expressions in attributes.

## 25.4 Rendered condition

```xml
<h:panelGroup rendered="#{security.admin}">
```

But do not rely on rendered for authorization.

## 25.5 Ajax listener

```xml
<f:ajax listener="#{bean.onChange}" />
```

## 25.6 Lifecycle timing

Same expression can be evaluated multiple times in different phases.

## 25.7 Getter caution

Faces render may call getter repeatedly.

Avoid side effects and expensive calls.

## 25.8 CDI named beans

Faces EL resolves CDI `@Named` beans through integration resolver.

---

# 26. Integration dengan Jakarta Pages / JSP

JSP uses EL for template expressions.

## 26.1 Implicit objects

Common JSP EL implicit objects include:

- `pageContext`;
- `pageScope`;
- `requestScope`;
- `sessionScope`;
- `applicationScope`;
- `param`;
- `paramValues`;
- `header`;
- `headerValues`;
- `cookie`;
- `initParam`.

## 26.2 Example

```jsp
${param.productId}
${sessionScope.profile.name}
${header['User-Agent']}
```

## 26.3 Immediate evaluation

JSP commonly uses `${...}`.

## 26.4 JSTL

JSTL uses EL in tag attributes.

```jsp
<c:if test="${not empty user}">
```

## 26.5 Scope resolution

If no explicit scope:

```jsp
${user}
```

resolver searches scopes in defined order.

Explicit scope is clearer.

## 26.6 Security

Do not output unescaped user data in JSP.

JSP EL itself returns value; escaping depends tag/context.

## 26.7 Modern note

Jakarta Pages/JSP is still in Jakarta EE, but many modern apps prefer Faces/REST/template engine. Legacy apps still require EL knowledge.

---

# 27. Integration dengan CDI

CDI beans can be exposed to EL using `@Named`.

## 27.1 Example

```java
@Named
@RequestScoped
public class UserForm {
    public String getEmail() { ... }
}
```

View:

```xml
#{userForm.email}
```

## 27.2 Default bean name

Class `UserForm` becomes default name:

```text
userForm
```

## 27.3 Explicit name

```java
@Named("form")
```

EL:

```text
#{form.email}
```

## 27.4 Scope matters

EL resolution can create/use CDI bean according to scope.

## 27.5 Ambiguity

If two beans have same name:

```text
ambiguous dependency / deployment issue
```

or resolver conflict depending environment.

## 27.6 CDI proxy

EL may interact with CDI proxies.

Method/property call eventually delegates to contextual instance.

## 27.7 Do not expose too much

Only `@Named` beans intended for views should be exposed.

Avoid naming internal sensitive services if not needed.

---

# 28. Integration dengan Bean Validation dan Message Interpolation

Jakarta Validation message interpolation can use expression-like syntax.

## 28.1 Constraint message

```java
@Size(min = 3, message = "Must be at least {min} characters")
```

## 28.2 EL in messages

Bean Validation supports expression interpolation in messages in some contexts.

Example concept:

```text
${validatedValue}
```

or conditional formatting depending provider/version.

## 28.3 Security

Constraint messages may include user values.

Avoid leaking sensitive data.

## 28.4 Performance

Validation messages are normally low-cost, but complex interpolation can add overhead.

## 28.5 Localization

Messages come from resource bundles.

## 28.6 Faces integration

Faces displays Bean Validation messages via `FacesMessage`.

## 28.7 Keep message logic simple

Do not put complex business logic in message expressions.

---

# 29. Custom ELResolver

Custom resolver lets you define how expressions resolve.

## 29.1 Use cases

- custom variable namespace;
- tenant-specific config;
- feature flag access;
- domain dictionary;
- safe rule environment;
- framework integration.

## 29.2 Example concept

Expression:

```text
#{feature['newDashboard']}
```

Resolver checks feature service.

## 29.3 Basic skeleton

```java
public class FeatureELResolver extends ELResolver {

    @Override
    public Object getValue(ELContext context, Object base, Object property) {
        if (base == null && "feature".equals(property)) {
            context.setPropertyResolved(true);
            return featureMap;
        }
        return null;
    }

    @Override
    public Class<?> getType(ELContext context, Object base, Object property) {
        return null;
    }

    @Override
    public void setValue(ELContext context, Object base, Object property, Object value) {
    }

    @Override
    public boolean isReadOnly(ELContext context, Object base, Object property) {
        return true;
    }

    @Override
    public Iterator<FeatureDescriptor> getFeatureDescriptors(ELContext context, Object base) {
        return null;
    }

    @Override
    public Class<?> getCommonPropertyType(ELContext context, Object base) {
        return Object.class;
    }
}
```

## 29.4 Registering resolver

Registration depends environment:

- Faces application config;
- JSP/Servlet container config;
- programmatic ELProcessor/ELManager.

## 29.5 Resolver order

Critical.

A resolver can shadow existing variables.

## 29.6 Keep resolver deterministic

Avoid slow/external calls in render path.

## 29.7 Thread safety

Resolver may be shared.

Make it thread-safe.

## 29.8 Security

Custom resolver should enforce read/write restrictions.

---

# 30. Custom Function dan Domain DSL

Sometimes teams create domain-specific expressions.

Example:

```text
#{policy:canApprove(actor, case)}
```

or:

```text
amount > 1000 and applicant.riskLevel == 'HIGH'
```

## 30.1 Good use

- simple configurable display condition;
- rule prototype;
- safe allowlisted functions;
- admin config with governance.

## 30.2 Bad use

- full business rule engine without audit;
- arbitrary expression from user;
- direct access to services/entities;
- mutating state;
- external calls in expression.

## 30.3 Rule engine caution

EL is not automatically a safe rule engine.

If building configurable rules:

- version expressions;
- validate expression at save time;
- restrict accessible variables/functions;
- log evaluation;
- add tests/simulation;
- handle errors;
- avoid side effects;
- provide migration strategy.

## 30.4 Audit

Store:

- expression text;
- version;
- author;
- approved by;
- effective date;
- evaluation input summary;
- result.

## 30.5 Explainability

EL expressions can be hard to explain if too complex.

## 30.6 Alternative

For complex rules, consider dedicated rules engine or code-based policy service.

---

# 31. Expression Caching dan Performance

## 31.1 Parsing cost

Parsing expression string repeatedly is wasteful.

Bad:

```java
for (Item item : items) {
    factory.createValueExpression(ctx, exprString, Object.class).getValue(ctx);
}
```

## 31.2 Cache parsed expression

```java
ValueExpression expr = cache.computeIfAbsent(exprString, s ->
    factory.createValueExpression(ctx, s, Object.class)
);
```

But be careful: expression may depend on function/variable mapper at creation time.

## 31.3 Do not cache request context

Cache expression object, not ELContext.

## 31.4 Render-time methods

Avoid expensive method calls in EL because framework can evaluate repeatedly.

## 31.5 Getter performance

In Faces, getter may be called multiple times.

Cache in backing bean if needed.

## 31.6 Resolver performance

Custom resolver should be fast.

## 31.7 Reflection cost

BeanELResolver uses reflection/introspection.

Implementations cache descriptors, but excessive dynamic access can still cost.

## 31.8 Measure

Use profiling.

Do not assume EL is bottleneck before measuring.

---

# 32. Security: EL Injection dan Dynamic Evaluation Risk

## 32.1 What is EL injection?

If attacker controls expression string that server evaluates, attacker may read/invoke things.

Bad:

```java
String expr = request.getParameter("expr");
Object result = elProcessor.eval(expr);
```

## 32.2 Why dangerous?

Depending environment, EL can access:

- beans;
- properties;
- methods;
- static classes/functions;
- request/session data;
- application services.

## 32.3 Template injection analogy

EL injection is similar to server-side template injection.

## 32.4 Dangerous patterns

- admin-defined expressions without allowlist;
- user-provided expressions;
- dynamic `rendered` expression stored in database;
- workflow conditions editable by untrusted user;
- constructing expression by concatenating user input.

## 32.5 Example bad concatenation

```java
String expr = "#{user." + fieldFromRequest + "}";
```

If field not validated, behavior unpredictable.

## 32.6 Safer dynamic property

Use allowlist:

```java
Map<String, Function<User, Object>> allowedFields = Map.of(
    "email", User::email,
    "name", User::name
);
```

## 32.7 Least privilege expression context

Expose only needed variables/functions.

## 32.8 No side effects

If expression language used for rules, make functions pure/read-only.

## 32.9 Logging

Log expression errors without leaking secrets.

---

# 33. Sandboxing dan Restricting Expressions

## 33.1 Need sandbox when expressions are configurable

If expressions are authored by admins/business users, they still need controls.

## 33.2 Restrict variables

Expose only:

```text
actor
resource
context
```

not whole application container.

## 33.3 Restrict functions

Allowlist pure functions.

## 33.4 Disable static access if possible

Avoid imports/static method access.

## 33.5 Custom resolver

Use custom resolver instead of default broad resolver.

## 33.6 Validate expression AST?

EL standard API may not expose full AST portably.

But you can validate by controlled evaluation/testing or implementation-specific parser.

## 33.7 Execution timeout

EL itself may not provide robust timeout. Avoid expressions capable of heavy loops/collections.

## 33.8 No mutation

Do not allow `setValue` or mutating methods in untrusted rule expressions.

## 33.9 Version and approval

Treat expressions as code/config requiring review.

---

# 34. Error Handling dan Debugging

## 34.1 Common exceptions

- `ELException`;
- `PropertyNotFoundException`;
- `PropertyNotWritableException`;
- `MethodNotFoundException`.

## 34.2 Property not found

Causes:

- typo;
- wrong bean name;
- wrong scope;
- getter missing;
- map key missing;
- resolver order;
- null intermediate base.

## 34.3 Property not writable

Causes:

- setter missing;
- read-only resolver;
- final/unmodifiable map/list;
- computed expression.

## 34.4 Method not found

Causes:

- typo;
- wrong parameters;
- overload ambiguity;
- CDI proxy issue;
- method not public.

## 34.5 Coercion error

Causes:

- invalid number/date/enum;
- wrong expected type;
- converter conflict in Faces.

## 34.6 Debug steps

1. Evaluate simpler expression.
2. Print base object class.
3. Check bean name.
4. Check getters/setters.
5. Check scope.
6. Check resolver order.
7. Check expected type.
8. Check method signature.
9. Check framework lifecycle timing.

## 34.7 Faces-specific

If action not called, check validation messages first.

It may not be EL issue.

## 34.8 Avoid swallowing ELException

Wrap with context:

```text
expression, expected type, variables exposed
```

without sensitive values.

---

# 35. Testing Strategy

## 35.1 Unit test expressions

For configurable expressions, test them directly with `ELProcessor`.

## 35.2 Test allowlist

Ensure forbidden variables/functions/classes unavailable.

## 35.3 Test coercion

Test:

- null;
- empty string;
- number string;
- enum string;
- boolean;
- invalid input.

## 35.4 Test method expression

Invoke method expression with representative parameters.

## 35.5 Test Faces integration

Use integration/UI tests for lifecycle-dependent expressions.

## 35.6 Negative tests

- unknown property;
- read-only property;
- invalid method;
- malicious expression;
- huge collection;
- null intermediate.

## 35.7 Performance tests

Benchmark repeated evaluations with and without caching.

## 35.8 Security tests

Try expressions attempting:

- class import;
- static access;
- service access;
- mutation;
- sensitive property read.

## 35.9 Snapshot rules

If expressions are stored config, test all active expressions in CI/startup.

---

# 36. Production Failure Modes

## 36.1 Bean not found

Cause:

- missing `@Named`;
- wrong bean name;
- scope inactive;
- CDI deployment error.

## 36.2 Setter not called

Cause:

- expression read-only;
- validation failed before model update;
- missing setter;
- wrong component lifecycle.

## 36.3 Wrong property resolved

Cause:

- map key shadows bean property;
- resolver order;
- scope ambiguity.

## 36.4 Method not invoked

Cause:

- wrong signature;
- validation short-circuit in Faces;
- expression parsed as value not method;
- wrong component attribute.

## 36.5 Type coercion surprise

Cause:

- empty string/null conversion;
- numeric type mismatch;
- enum mismatch.

## 36.6 Performance drop

Cause:

- expression parsed repeatedly;
- getter/method expensive;
- custom resolver slow;
- collection operations in view.

## 36.7 Security exposure

Cause:

- untrusted dynamic expression;
- broad ELProcessor context;
- static method import;
- exposed sensitive CDI bean.

## 36.8 Migration break

Cause:

- `javax.el` to `jakarta.el`;
- older JSP/Faces tag namespaces;
- implementation version mismatch.

## 36.9 Classloading issue

Cause:

- bundled API/impl conflicts with container.

## 36.10 Rule config breaks production

Cause:

- admin-edited expression not validated/tested before activation.

---

# 37. Best Practices dan Anti-Patterns

## 37.1 Best practices

- Keep EL simple in views.
- Use EL for binding, not complex business logic.
- Expose only intended beans with `@Named`.
- Avoid expensive method calls/getters.
- Use explicit scopes in JSP when clarity matters.
- Cache parsed expressions for repeated standalone evaluation.
- Use allowlist for dynamic/configurable expressions.
- Treat expressions as code when persisted/configurable.
- Test coercion and null behavior.
- Avoid ambiguous method overloads.
- Keep custom resolvers fast and deterministic.
- Avoid static access in untrusted contexts.

## 37.2 Anti-pattern: Business logic in EL

Bad:

```xml
rendered="#{orderService.canApprove(order) and riskService.score(order) < 50}"
```

Better:

```xml
rendered="#{orderView.canApprove}"
```

computed in bean/service.

## 37.3 Anti-pattern: User-supplied EL

Never evaluate raw user input as expression.

## 37.4 Anti-pattern: DB call in getter

Faces may call getter many times.

## 37.5 Anti-pattern: Expose all services as named beans

Limits security and clarity.

## 37.6 Anti-pattern: Overloaded methods for EL

Can fail due coercion/ambiguity.

## 37.7 Anti-pattern: No tests for configurable rules

A typo becomes production outage.

---

# 38. Checklist Review

## 38.1 Expression design

- [ ] Is expression simple?
- [ ] Value vs method expression correct?
- [ ] Immediate vs deferred delimiter correct?
- [ ] Expected type known?
- [ ] Null behavior tested?
- [ ] Coercion tested?

## 38.2 Beans/resolvers

- [ ] Bean has `@Named`?
- [ ] Scope appropriate?
- [ ] Getter/setter exists?
- [ ] Resolver order understood?
- [ ] Custom resolver thread-safe?
- [ ] Custom resolver fast?

## 38.3 Faces/JSP

- [ ] Faces lifecycle considered?
- [ ] Action not blocked by validation?
- [ ] JSP scope explicit if needed?
- [ ] Output escaping handled?

## 38.4 Dynamic expressions

- [ ] User cannot supply raw expression?
- [ ] Variables allowlisted?
- [ ] Functions allowlisted?
- [ ] Static access restricted?
- [ ] Expression versioned/audited?
- [ ] Active expressions tested?

## 38.5 Performance

- [ ] Parsed expressions cached if repeated?
- [ ] Getters cheap?
- [ ] No DB call in EL?
- [ ] No large collection processing in view?

---

# 39. Case Study 1: Faces Form Binding `#{userForm.email}`

## 39.1 View

```xml
<h:inputText id="email" value="#{userForm.email}" required="true" />
<h:commandButton value="Save" action="#{userForm.save}" />
```

## 39.2 During render

EL reads:

```text
userForm.email
```

calls:

```java
getEmail()
```

## 39.3 During postback

Faces decodes submitted value.

Validation/conversion happens.

If valid, Faces writes:

```text
userForm.email = submittedEmail
```

calls:

```java
setEmail(...)
```

Then invokes:

```text
userForm.save
```

## 39.4 If email invalid

Model update skipped.

`save()` not called.

## 39.5 Lesson

EL expression participates in lifecycle, not one-time getter call.

---

# 40. Case Study 2: Dynamic Rule Engine yang Berbahaya

## 40.1 Requirement

Admin wants configurable rule:

```text
amount > 1000 and customer.vip
```

## 40.2 Bad implementation

```java
String expr = databaseRule.getExpression();
boolean result = (Boolean) elProcessor.eval(expr);
```

With broad context.

## 40.3 Risk

Admin/attacker can access methods/classes/services not intended.

## 40.4 Safer design

Expose only safe variables:

```text
amount
customerRisk
transactionType
```

Expose only safe functions:

```text
isHighRisk(...)
inCountry(...)
```

Validate expression before activation.

Log/audit.

## 40.5 Better for complex rules

Use dedicated policy/rule engine or code-based policy.

## 40.6 Lesson

Dynamic EL is code execution. Govern it.

---

# 41. Case Study 3: Resolver Chain Membaca Map, Bukan Bean

## 41.1 Problem

Expression:

```text
#{user.name}
```

Expected bean property `User.getName()`.

But `user` is actually a Map in request scope:

```java
request.setAttribute("user", Map.of("name", "Map Name"));
```

## 41.2 Result

MapELResolver resolves `"name"` key.

Not BeanELResolver.

## 41.3 Root cause

Top-level variable resolved to Map due scope/resolver.

## 41.4 Fix

Use clearer names/scopes:

```text
#{userBean.name}
#{requestScope.user['name']}
```

## 41.5 Lesson

Dot syntax does not guarantee JavaBean property. Base object type matters.

---

# 42. Case Study 4: Performance Drop karena Expression Diparse Berulang

## 42.1 Bad code

```java
for (Rule rule : rules) {
    Object result = processor.eval(rule.expression());
}
```

Each eval parses expression repeatedly.

## 42.2 Worse

Expression calls service methods and collection filters.

## 42.3 Fix

- compile/cache `ValueExpression`;
- expose simple DTO variables;
- avoid service calls from EL;
- benchmark;
- pre-validate rules.

## 42.4 Cache design

Cache key:

```text
expression string + expected type + function/variable mapper config version
```

## 42.5 Lesson

Expression parsing and reflection are not free.

---

# 43. Latihan Bertahap

## Latihan 1 — ELProcessor basic

Evaluate:

```text
1 + 2
'Hello ' += name
```

depending supported syntax.

## Latihan 2 — Define bean

Define `user` bean and evaluate:

```text
user.name
```

## Latihan 3 — ValueExpression read/write

Create `ValueExpression` for `#{user.email}`.

Read and set value.

## Latihan 4 — MethodExpression

Invoke:

```text
#{calculator.add}
```

with parameters.

## Latihan 5 — Resolver order

Create Map and Bean with same name/key.

Observe resolution.

## Latihan 6 — Type coercion

Evaluate string-to-number/boolean/enum.

## Latihan 7 — FunctionMapper

Expose static function:

```text
mask:email(user.email)
```

## Latihan 8 — Custom ELResolver

Create read-only resolver for `feature['x']`.

## Latihan 9 — Security test

Try to evaluate dangerous expressions in sandbox.

Ensure blocked.

## Latihan 10 — Performance

Benchmark parsing each time vs cached expression.

---

# 44. Mini Project: Jakarta EL Evaluation Lab

## 44.1 Goal

Create:

```text
jakarta-el-evaluation-lab/
```

## 44.2 Modules

```text
basic-elprocessor/
value-expression/
method-expression/
resolver-chain/
custom-resolver/
function-mapper/
type-coercion/
faces-binding-simulation/
sandboxed-rules/
expression-cache/
```

## 44.3 Deliverables

```text
README.md
EL-MENTAL-MODEL.md
IMMEDIATE-VS-DEFERRED.md
VALUE-VS-METHOD.md
RESOLVER-CHAIN.md
TYPE-COERCION.md
CUSTOM-RESOLVER.md
SECURITY-SANDBOX.md
PERFORMANCE.md
FAILURE-MODES.md
```

## 44.4 Required experiments

1. Evaluate immediate expressions.
2. Create deferred `ValueExpression`.
3. Read/write bean property.
4. Invoke method expression.
5. Add function.
6. Add custom resolver.
7. Test null/coercion behavior.
8. Simulate Faces model update.
9. Sandbox allowlisted variables/functions.
10. Benchmark cached expressions.

## 44.5 Evaluation questions

1. What is `ELContext`?
2. What is resolver chain?
3. Difference between `${}` and `#{}`?
4. Difference between value and method expression?
5. What is lvalue?
6. Why can dot syntax access map key?
7. Why is user-supplied EL dangerous?
8. Why avoid DB calls in getters?
9. How does Faces use EL during lifecycle?
10. What should be cached for repeated evaluation?

---

# 45. Referensi Resmi

Referensi utama:

1. Jakarta Expression Language 6.0  
   https://jakarta.ee/specifications/expression-language/6.0/

2. Jakarta Expression Language 6.0 Specification  
   https://jakarta.ee/specifications/expression-language/6.0/jakarta-expression-language-spec-6.0

3. Jakarta Expression Language 6.0 API Docs  
   https://jakarta.ee/specifications/expression-language/6.0/apidocs/

4. API Docs — `jakarta.el` package summary  
   https://jakarta.ee/specifications/expression-language/6.0/apidocs/jakarta.el/jakarta/el/package-summary

5. Jakarta EE Tutorial — Jakarta Expression Language  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/faces-el/faces-el.html

6. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

7. Jakarta Faces 4.1  
   https://jakarta.ee/specifications/faces/4.1/

8. Jakarta Pages 4.0  
   https://jakarta.ee/specifications/pages/4.0/

9. Jakarta CDI 4.1  
   https://jakarta.ee/specifications/cdi/4.1/

10. Jakarta Validation 3.1  
    https://jakarta.ee/specifications/bean-validation/3.1/

---

# Penutup

Jakarta Expression Language adalah expression evaluation engine yang menjadi glue di banyak teknologi Jakarta EE.

Mental model ringkas:

```text
Expression string
  ↓
ExpressionFactory parses
  ↓
ValueExpression / MethodExpression
  ↓
ELContext
  ↓
ELResolver chain
  ↓
type coercion
  ↓
value read/write or method invocation
```

Prinsip paling penting:

```text
EL is not just property access.
EL is controlled runtime evaluation.
```

Gunakan EL untuk binding dan simple presentation logic.

Hindari:

- business logic kompleks dalam EL;
- DB/external call dari getter/method render;
- user-supplied expressions;
- unrestricted `ELProcessor`;
- static access tanpa kontrol;
- resolver custom yang lambat/ambigu.

Engineer top-tier tahu bahwa `#{bean.property}` bukan sekadar string ajaib. Ia tahu kapan getter dipanggil, kapan setter dipanggil, resolver mana yang jalan, bagaimana type coercion terjadi, kenapa `${}` dan `#{}` berbeda, kenapa action Faces bisa tidak terpanggil, dan kenapa dynamic EL perlu diperlakukan seperti code execution.

Bagian berikutnya akan membahas **Jakarta Server Pages (`jakarta.servlet.jsp`) / Jakarta Pages**: JSP lifecycle, translation to servlet, tag libraries, JSTL, EL integration, implicit objects, custom tags, migration, security, and modern relevance.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 26 — Jakarta Faces (`jakarta.faces`): Component-Based Server-Side UI, Lifecycle, State, Validation, Ajax, dan Modern Relevance](./learn-java-jakarta-part-026.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 28 — Jakarta Pages / JSP (`jakarta.servlet.jsp`): Translation to Servlet, Tag Libraries, EL, JSTL, dan Modern Relevance](./learn-java-jakarta-part-028.md)
