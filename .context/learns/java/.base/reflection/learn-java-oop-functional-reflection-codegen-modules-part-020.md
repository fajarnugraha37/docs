# learn-java-oop-functional-reflection-codegen-modules-part-020

# MethodHandles and VarHandles: Safer, Faster, Lower-Level Dynamic Access

> Seri: `learn-java-oop-functional-reflection-codegen-modules`  
> Part: `020`  
> Topik: `MethodHandle`, `MethodHandles.Lookup`, `MethodType`, `VarHandle`, dynamic access, typed invocation, access control, dynamic runtime design

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas reflection klasik:

- membaca metadata class,
- mengambil `Field`, `Method`, `Constructor`,
- memanggil method secara dinamis,
- membuat instance secara reflektif,
- memakai JDK dynamic proxy,
- memahami bagaimana framework memakai reflection.

Bagian ini naik satu level lebih dekat ke runtime JVM melalui dua API penting:

1. **`MethodHandle`**  
   Representasi typed dan executable untuk method, constructor, field accessor, atau operasi sejenis.

2. **`VarHandle`**  
   Representasi typed untuk akses variable: field instance, static field, array element, dan bentuk variable-like lain, dengan mode akses seperti plain, volatile, acquire/release, dan atomic compare-and-set.

Keduanya berada di package:

```java
java.lang.invoke
```

Mental model utamanya:

> Reflection klasik cocok untuk introspection dan invocation dinamis yang manusiawi.  
> Method handle dan var handle cocok untuk dynamic runtime, framework, generated code, language runtime, high-performance adapter, dan low-level access yang perlu lebih typed, composable, dan JIT-friendly.

---

## 1. Kenapa Java Punya MethodHandle dan VarHandle?

Reflection klasik sudah bisa melakukan banyak hal:

```java
Method m = User.class.getDeclaredMethod("email");
Object result = m.invoke(user);
```

Masalahnya, reflection klasik punya karakteristik:

- invocation berbasis `Object[]` secara konseptual,
- type checking banyak terjadi saat runtime,
- exception dibungkus `InvocationTargetException`,
- API lebih cocok untuk metadata dan tooling,
- invocation tidak sejelas direct call dari sudut JVM optimizer,
- akses field/method terasa stringly typed,
- composability terbatas.

`MethodHandle` lahir untuk memberi JVM model yang lebih dekat ke executable reference.

Secara konseptual:

```text
Reflection Method:
  "Saya punya metadata method. Tolong panggil secara reflektif."

MethodHandle:
  "Saya punya executable typed handle ke operasi tertentu. Panggil seperti function object level JVM."
```

`VarHandle` lahir untuk menggantikan banyak kebutuhan yang dulu sering memakai `sun.misc.Unsafe`, khususnya akses variable dengan mode memory-ordering/atomic yang lebih aman dan standar.

---

## 2. Reflection vs MethodHandle vs VarHandle

| Aspek | Reflection | MethodHandle | VarHandle |
|---|---|---|---|
| Fokus | Metadata + dynamic invocation | Typed executable operation | Typed variable access |
| Unit utama | `Class`, `Method`, `Field`, `Constructor` | `MethodHandle` | `VarHandle` |
| Invocation | `method.invoke(receiver, args...)` | `handle.invoke(...)` / `invokeExact(...)` | `get`, `set`, `compareAndSet`, etc. |
| Type model | Runtime checks, object-oriented wrapper | `MethodType` | Variable type + coordinate types |
| Exception | Invocation dibungkus | Lebih langsung | Bergantung operation |
| Performance intent | General reflective access | JIT-friendly dynamic invocation | Standardized low-level/atomic variable access |
| Cocok untuk | metadata scanner, frameworks, tools | generated adapters, dynamic language runtime, high-performance dispatch | field/array atomic access, volatile/acquire/release semantics |

Rule sederhana:

- Butuh membaca struktur class? **Reflection.**
- Butuh dynamic method call yang sering dipakai dan bisa dicache? **MethodHandle.**
- Butuh akses variable/field/array secara typed dan/atau atomic? **VarHandle.**

---

## 3. Mental Model MethodHandle

`MethodHandle` adalah reference ke operasi executable.

Operasi itu bisa berupa:

- instance method,
- static method,
- constructor,
- field getter,
- field setter,
- array element getter/setter,
- adapter/combinator hasil transformasi handle lain.

Bayangkan method handle seperti function pointer yang:

- punya type signature,
- mengikuti access control Java,
- bisa diadaptasi,
- bisa dicache,
- bisa dipakai oleh runtime JVM seperti `invokedynamic`.

Contoh target class:

```java
public final class Person {
    private final String name;

    public Person(String name) {
        this.name = name;
    }

    public String name() {
        return name;
    }

    public String greet(String prefix) {
        return prefix + " " + name;
    }

    public static Person of(String name) {
        return new Person(name);
    }
}
```

Method handle untuk instance method `greet` secara konseptual memiliki signature:

```text
(Person, String)String
```

Kenapa receiver `Person` masuk sebagai parameter pertama?

Karena instance method butuh object target.

Direct call:

```java
person.greet("Hello")
```

MethodHandle view:

```text
greet(person, "Hello")
```

Ini penting untuk memahami `bindTo`, `invokeExact`, dan adapter.

---

## 4. `MethodType`: Signature Sebagai Object

`MethodHandle` selalu punya `MethodType`.

`MethodType` menjelaskan:

- return type,
- parameter types.

Contoh:

```java
import java.lang.invoke.MethodType;

MethodType greetType = MethodType.methodType(String.class, String.class);
```

Artinya:

```text
(String)String
```

Untuk mencari instance method `Person.greet(String): String`, kita tidak memasukkan receiver ke `MethodType` saat lookup:

```java
MethodType.methodType(String.class, String.class)
```

Tapi handle yang dihasilkan untuk virtual method secara invocation type biasanya memasukkan receiver sebagai argumen pertama:

```text
(Person, String)String
```

Contoh lengkap:

```java
import java.lang.invoke.MethodHandle;
import java.lang.invoke.MethodHandles;
import java.lang.invoke.MethodType;

public class MethodHandleExample {
    public static void main(String[] args) throws Throwable {
        MethodHandles.Lookup lookup = MethodHandles.lookup();

        MethodHandle greet = lookup.findVirtual(
            Person.class,
            "greet",
            MethodType.methodType(String.class, String.class)
        );

        Person person = new Person("Fajar");

        String result = (String) greet.invoke(person, "Hello");
        System.out.println(result); // Hello Fajar
    }
}
```

Dengan `invoke`, JVM boleh melakukan beberapa conversion dinamis.

Dengan `invokeExact`, signature harus cocok persis.

---

## 5. `invoke` vs `invokeExact`

Ini salah satu bagian paling penting.

### 5.1 `invoke`

`invoke` lebih fleksibel.

Ia dapat menerima beberapa adaptasi type, misalnya boxing/unboxing/cast tertentu.

```java
Object result = greet.invoke(person, "Hello");
```

Lebih mudah dipakai, tetapi kontrak type-nya kurang ketat.

### 5.2 `invokeExact`

`invokeExact` menuntut signature compile-time call site cocok persis dengan `MethodHandle.type()`.

Contoh:

```java
String result = (String) greet.invokeExact(person, "Hello");
```

Untuk handle bertipe:

```text
(Person, String)String
```

Call site harus cocok:

- argumen pertama `Person`, bukan `Object`,
- argumen kedua `String`,
- return type digunakan sebagai `String`.

Ini bisa gagal walaupun secara manusia terlihat masuk akal.

Contoh jebakan:

```java
Object p = new Person("Fajar");
String result = (String) greet.invokeExact(p, "Hello");
```

Ini salah karena call site memakai `Object`, bukan `Person`.

Perbaikan:

```java
Person p = new Person("Fajar");
String result = (String) greet.invokeExact(p, "Hello");
```

Atau adaptasi handle:

```java
MethodHandle adapted = greet.asType(
    MethodType.methodType(String.class, Object.class, String.class)
);

String result = (String) adapted.invokeExact((Object) new Person("Fajar"), "Hello");
```

Mental model:

```text
invoke      = dynamic-friendly
invokeExact = exact call-site contract
```

Untuk framework/generator serius, `invokeExact` bisa lebih eksplisit dan optimizer-friendly, tetapi lebih mudah salah jika tidak disiplin.

---

## 6. `MethodHandles.Lookup`: Capability Object untuk Access Control

Method handle tidak dibuat sembarangan. Biasanya dibuat melalui `MethodHandles.Lookup`.

```java
MethodHandles.Lookup lookup = MethodHandles.lookup();
```

`Lookup` bukan sekadar factory. Ia adalah **capability object**.

Artinya:

> Object ini membawa hak akses dari lokasi kode yang membuatnya.

Jika kode berada di class `A`, maka `MethodHandles.lookup()` memiliki access privilege sesuai konteks class `A`.

Contoh operasi lookup:

```java
lookup.findVirtual(...)
lookup.findStatic(...)
lookup.findConstructor(...)
lookup.findGetter(...)
lookup.findSetter(...)
lookup.findStaticGetter(...)
lookup.findStaticSetter(...)
lookup.unreflect(method)
lookup.unreflectGetter(field)
lookup.unreflectSetter(field)
```

### 6.1 Public lookup

```java
MethodHandles.Lookup publicLookup = MethodHandles.publicLookup();
```

Ini hanya untuk akses public.

### 6.2 Private lookup

Untuk akses private lintas class secara sah:

```java
MethodHandles.Lookup privateLookup = MethodHandles.privateLookupIn(
    Target.class,
    MethodHandles.lookup()
);
```

Tapi ini tetap tunduk pada:

- access control Java,
- module boundary,
- apakah package/module membuka akses yang diperlukan.

Di era JPMS, private access bukan hanya masalah `setAccessible(true)`. Module harus mengizinkan deep reflective/private access melalui `opens` atau qualified `opens`.

---

## 7. Lookup Instance Method

Target:

```java
public final class Calculator {
    public int add(int a, int b) {
        return a + b;
    }
}
```

Lookup:

```java
MethodHandles.Lookup lookup = MethodHandles.lookup();

MethodHandle add = lookup.findVirtual(
    Calculator.class,
    "add",
    MethodType.methodType(int.class, int.class, int.class)
);

Calculator calculator = new Calculator();
int result = (int) add.invokeExact(calculator, 10, 20);
```

Handle type:

```text
(Calculator, int, int)int
```

Receiver menjadi parameter pertama.

---

## 8. Lookup Static Method

Target:

```java
public final class MathOps {
    public static int multiply(int a, int b) {
        return a * b;
    }
}
```

Lookup:

```java
MethodHandle multiply = lookup.findStatic(
    MathOps.class,
    "multiply",
    MethodType.methodType(int.class, int.class, int.class)
);

int result = (int) multiply.invokeExact(6, 7);
```

Handle type:

```text
(int, int)int
```

Tidak ada receiver.

---

## 9. Lookup Constructor

Target:

```java
public final class Money {
    private final String currency;
    private final long amount;

    public Money(String currency, long amount) {
        this.currency = currency;
        this.amount = amount;
    }
}
```

Lookup constructor:

```java
MethodHandle ctor = lookup.findConstructor(
    Money.class,
    MethodType.methodType(void.class, String.class, long.class)
);

Money money = (Money) ctor.invokeExact("IDR", 100_000L);
```

Kenapa return type `void.class` pada `MethodType`?

Karena constructor di level JVM bukan method biasa yang return object. Namun method handle constructor yang dihasilkan akan dipanggil dan menghasilkan instance.

Secara pemakaian, hasilnya adalah `Money`.

---

## 10. Field Getter dan Setter dengan MethodHandle

Target:

```java
public final class MutableCounter {
    public int value;
}
```

Getter:

```java
MethodHandle getter = lookup.findGetter(
    MutableCounter.class,
    "value",
    int.class
);
```

Setter:

```java
MethodHandle setter = lookup.findSetter(
    MutableCounter.class,
    "value",
    int.class
);
```

Pemakaian:

```java
MutableCounter counter = new MutableCounter();

setter.invokeExact(counter, 42);
int value = (int) getter.invokeExact(counter);
```

Handle type:

```text
getter: (MutableCounter)int
setter: (MutableCounter, int)void
```

Untuk static field, pakai:

```java
findStaticGetter
findStaticSetter
```

---

## 11. `unreflect`: Bridge dari Reflection ke MethodHandle

Kadang framework sudah punya `Method` dari scanning reflection.

Kita bisa mengubahnya menjadi `MethodHandle`:

```java
Method method = Person.class.getDeclaredMethod("greet", String.class);
MethodHandle handle = lookup.unreflect(method);
```

Untuk constructor:

```java
Constructor<Person> ctor = Person.class.getConstructor(String.class);
MethodHandle handle = lookup.unreflectConstructor(ctor);
```

Untuk field:

```java
Field field = MutableCounter.class.getDeclaredField("value");
MethodHandle getter = lookup.unreflectGetter(field);
MethodHandle setter = lookup.unreflectSetter(field);
```

Pola framework umum:

```text
startup:
  scan metadata via reflection
  validate annotations/types
  convert hot-path operations to MethodHandle
  cache handles

runtime:
  use cached MethodHandle
```

Ini menggabungkan kelebihan reflection dan method handle.

---

## 12. Binding Receiver dengan `bindTo`

Instance method handle awalnya membutuhkan receiver.

```text
(Person, String)String
```

Dengan `bindTo`, receiver bisa dikunci:

```java
Person person = new Person("Fajar");
MethodHandle bound = greet.bindTo(person);

String result = (String) bound.invokeExact("Hello");
```

Handle type berubah:

```text
Before: (Person, String)String
After : (String)String
```

Use case:

- callback object,
- per-instance adapter,
- generated dispatcher,
- event handler binding,
- plugin method binding.

Risiko:

- bound handle menyimpan reference ke receiver,
- bisa menyebabkan memory leak jika dicache global,
- jangan bind object request/session lalu simpan di static cache.

---

## 13. Adaptasi MethodHandle

Method handle dapat diubah bentuknya.

Beberapa operasi penting:

```java
asType(...)
bindTo(...)
dropArguments(...)
insertArguments(...)
filterArguments(...)
filterReturnValue(...)
permuteArguments(...)
collectArguments(...)
foldArguments(...)
guardWithTest(...)
```

Ini membuat method handle bukan hanya pointer, tetapi building block untuk runtime composition.

### 13.1 `asType`

Mengadaptasi signature.

```java
MethodHandle adapted = add.asType(
    MethodType.methodType(Integer.class, Calculator.class, Integer.class, Integer.class)
);
```

Ini memungkinkan boxing/unboxing/cast tertentu.

### 13.2 `insertArguments`

Mengunci sebagian argumen.

```java
MethodHandle addTen = MethodHandles.insertArguments(add, 1, 10);
```

Jika `add` bertipe:

```text
(Calculator, int, int)int
```

Maka `addTen` menjadi:

```text
(Calculator, int)int
```

Karena argumen posisi 1 (`a`) sudah diisi `10`.

### 13.3 `dropArguments`

Menambah argumen yang diabaikan.

Berguna untuk menyesuaikan signature callback/framework.

```java
MethodHandle h2 = MethodHandles.dropArguments(handle, 0, RequestContext.class);
```

### 13.4 `filterArguments`

Memproses argumen sebelum masuk ke target.

Contoh konseptual:

```text
input String -> trim -> validate -> target
```

### 13.5 `guardWithTest`

Membuat conditional dispatch:

```text
if test(args) then target(args) else fallback(args)
```

Ini berguna untuk dynamic language runtime, rule engine, plugin dispatcher, atau generated decision path.

---

## 14. MethodHandle sebagai Runtime Dispatch Table

Misal kita membangun command dispatcher.

```java
public interface Command {}
public record ApproveCase(String caseId) implements Command {}
public record RejectCase(String caseId, String reason) implements Command {}
```

Handler:

```java
public final class CaseCommandHandler {
    public void handle(ApproveCase command) {
        System.out.println("Approve " + command.caseId());
    }

    public void handle(RejectCase command) {
        System.out.println("Reject " + command.caseId());
    }
}
```

Framework bisa scan method `handle(...)`, lalu membuat dispatch table:

```java
Map<Class<?>, MethodHandle> handlers = new HashMap<>();
```

Register:

```java
MethodHandle approveHandle = lookup.findVirtual(
    CaseCommandHandler.class,
    "handle",
    MethodType.methodType(void.class, ApproveCase.class)
);

handlers.put(ApproveCase.class, approveHandle);
```

Runtime dispatch:

```java
Command command = new ApproveCase("CASE-001");
MethodHandle handle = handlers.get(command.getClass());
handle.invoke(handlerInstance, command);
```

Kalau ingin lebih ketat, adaptasi semua ke common shape:

```text
(CaseCommandHandler, Command)void
```

Dengan `asType`:

```java
MethodHandle adapted = approveHandle.asType(
    MethodType.methodType(void.class, CaseCommandHandler.class, Command.class)
);
```

Lalu cache adapted handle.

Mental model:

```text
Reflection scanner menemukan struktur.
MethodHandle menjalankan hot-path.
Map/ClassValue menyimpan dispatch plan.
```

---

## 15. Exception Model MethodHandle

Method handle invocation bisa melempar `Throwable`.

Karena itu contoh biasanya:

```java
public static void main(String[] args) throws Throwable {
    ...
}
```

Dalam production code, jangan biarkan semua method `throws Throwable` tanpa boundary.

Buat adapter:

```java
public final class HandlerInvoker {
    private final Object target;
    private final MethodHandle handle;

    public HandlerInvoker(Object target, MethodHandle handle) {
        this.target = target;
        this.handle = handle;
    }

    public void invoke(Object command) {
        try {
            handle.invoke(target, command);
        } catch (RuntimeException | Error e) {
            throw e;
        } catch (Throwable e) {
            throw new HandlerInvocationException("Handler invocation failed", e);
        }
    }
}
```

Jangan bocorkan `Throwable` ke semua layer business.

Buat error boundary:

```text
infrastructure dynamic invocation failure
  -> wrap into framework exception
  -> attach handler metadata
  -> attach target class/method
  -> preserve cause
```

---

## 16. Performance Model MethodHandle

Jangan berpikir:

```text
MethodHandle selalu lebih cepat dari reflection.
```

Yang lebih tepat:

```text
MethodHandle lebih cocok untuk dynamic invocation yang dicache, memiliki stable shape, dan dipakai cukup sering sehingga JVM bisa mengoptimalkan call site.
```

Hal yang memengaruhi performa:

- handle dicache atau dibuat ulang terus,
- `invoke` vs `invokeExact`,
- type adaptation berlebihan,
- boxing/unboxing,
- apakah receiver/type stabil,
- apakah call path cukup panas,
- apakah exception sering terjadi,
- apakah benchmark benar.

Anti-pattern:

```java
for (Object item : items) {
    MethodHandle h = lookup.findVirtual(...); // buruk: lookup di hot loop
    h.invoke(item);
}
```

Lebih benar:

```java
MethodHandle h = lookup.findVirtual(...); // startup/init
for (Object item : items) {
    h.invoke(item);
}
```

Even better untuk dispatch by class:

```java
private final ClassValue<MethodHandle> accessors = new ClassValue<>() {
    @Override
    protected MethodHandle computeValue(Class<?> type) {
        return buildAccessor(type);
    }
};
```

`ClassValue` bisa berguna untuk cache metadata/handle per class dengan lifecycle yang lebih selaras dengan class unloading dibanding static `ConcurrentHashMap<Class<?>, ...>` yang ceroboh.

---

## 17. Kapan MethodHandle Layak Dipakai?

Gunakan `MethodHandle` jika:

- operasi dynamic dipanggil berkali-kali,
- reflection invoke menjadi hot path,
- Anda membangun framework internal,
- Anda menulis serializer/mapper/validator/DI tool,
- Anda membuat rule engine atau command dispatcher,
- Anda butuh adapter/combinator runtime,
- Anda butuh akses lebih typed dibanding reflection,
- Anda mengubah reflected member menjadi executable plan.

Jangan gunakan `MethodHandle` jika:

- direct call cukup,
- hanya satu-dua invocation administratif,
- tim tidak siap dengan kompleksitas API,
- readability lebih penting daripada dynamic performance,
- static polymorphism atau sealed switch sudah cukup,
- problem bisa diselesaikan dengan interface biasa.

Decision rule:

```text
Direct call > interface dispatch > generated code > MethodHandle > reflection invoke
```

Urutan ini bukan absolut, tapi bagus sebagai default desain.

---

## 18. Mental Model VarHandle

`VarHandle` adalah typed reference ke variable.

Variable di sini bisa berupa:

- instance field,
- static field,
- array element,
- byte array view,
- variable-like memory access tertentu.

Contoh field:

```java
public final class Counter {
    volatile int value;
}
```

VarHandle:

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

public final class CounterAccess {
    private static final VarHandle VALUE;

    static {
        try {
            VALUE = MethodHandles.lookup().findVarHandle(
                Counter.class,
                "value",
                int.class
            );
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public static int get(Counter counter) {
        return (int) VALUE.get(counter);
    }

    public static void set(Counter counter, int value) {
        VALUE.set(counter, value);
    }

    public static boolean compareAndSet(Counter counter, int expected, int update) {
        return VALUE.compareAndSet(counter, expected, update);
    }
}
```

Mental model:

```text
VarHandle = typed, access-controlled handle to variable + access mode operations
```

---

## 19. VarHandle Coordinate Types dan Variable Type

VarHandle punya dua konsep type:

1. **Variable type**  
   Type value yang dibaca/ditulis.

2. **Coordinate types**  
   Type yang diperlukan untuk menemukan variable tersebut.

Untuk instance field:

```java
class Counter { int value; }
```

VarHandle untuk `value` punya:

```text
coordinate types: (Counter)
variable type   : int
```

Untuk array element:

```java
int[] arr
```

VarHandle array element punya:

```text
coordinate types: (int[], int)
variable type   : int
```

Karena perlu array object dan index.

---

## 20. VarHandle untuk Field Instance

```java
public final class AccountState {
    private volatile String status;

    public AccountState(String status) {
        this.status = status;
    }
}
```

Private lookup:

```java
MethodHandles.Lookup lookup = MethodHandles.lookup();
MethodHandles.Lookup privateLookup = MethodHandles.privateLookupIn(
    AccountState.class,
    lookup
);

VarHandle statusHandle = privateLookup.findVarHandle(
    AccountState.class,
    "status",
    String.class
);
```

Access:

```java
AccountState state = new AccountState("DRAFT");

String current = (String) statusHandle.getVolatile(state);
statusHandle.setVolatile(state, "SUBMITTED");
```

Atomic CAS:

```java
boolean changed = statusHandle.compareAndSet(
    state,
    "SUBMITTED",
    "APPROVED"
);
```

---

## 21. VarHandle untuk Static Field

```java
public final class FeatureFlags {
    static volatile boolean ENABLED = false;
}
```

Lookup:

```java
VarHandle enabled = MethodHandles.lookup().findStaticVarHandle(
    FeatureFlags.class,
    "ENABLED",
    boolean.class
);
```

Access:

```java
boolean isEnabled = (boolean) enabled.getVolatile();
enabled.setVolatile(true);
```

Static field tidak butuh receiver coordinate.

---

## 22. VarHandle untuk Array Element

```java
VarHandle intArrayHandle = MethodHandles.arrayElementVarHandle(int[].class);

int[] values = {10, 20, 30};

int first = (int) intArrayHandle.get(values, 0);
intArrayHandle.set(values, 1, 99);

boolean updated = intArrayHandle.compareAndSet(values, 2, 30, 300);
```

Coordinate:

```text
(int[], int)
```

Variable type:

```text
int
```

Use case:

- low-level concurrent data structure,
- ring buffer,
- lock-free queue internals,
- generated array accessor,
- atomic slot update.

Untuk business application biasa, biasanya `AtomicIntegerArray`, `AtomicReferenceArray`, atau collection abstraction lebih readable.

---

## 23. Access Modes pada VarHandle

VarHandle mendukung banyak access mode.

Secara konseptual:

| Mode | Contoh Method | Kegunaan |
|---|---|---|
| Plain | `get`, `set` | Seperti akses field biasa |
| Volatile | `getVolatile`, `setVolatile` | Visibility kuat seperti volatile |
| Opaque | `getOpaque`, `setOpaque` | Ordering lebih lemah, advanced use |
| Acquire/Release | `getAcquire`, `setRelease` | One-way memory ordering advanced |
| Atomic CAS | `compareAndSet`, `weakCompareAndSet` | Conditional atomic update |
| Atomic exchange | `getAndSet` | Atomic swap |
| Atomic arithmetic | `getAndAdd` | Atomic add untuk numeric type |
| Bitwise atomic | `getAndBitwiseOr`, etc. | Atomic bit flags |

Untuk mayoritas engineer enterprise:

- pahami `get`, `set`,
- pahami `getVolatile`, `setVolatile`,
- pahami `compareAndSet`,
- hindari acquire/release/opaque kecuali benar-benar memahami Java Memory Model.

Karena seri concurrency sudah terpisah, bagian ini tidak akan mengulang JMM secara panjang. Namun prinsip desainnya:

> VarHandle memberi Anda pisau low-level. Jangan pakai untuk business state jika invariant bisa dijaga dengan lock, transaction, actor model, queue, atau database constraint.

---

## 24. VarHandle vs Atomic Classes

Java punya:

```java
AtomicInteger
AtomicLong
AtomicReference
AtomicBoolean
AtomicIntegerArray
AtomicReferenceArray
AtomicIntegerFieldUpdater
AtomicReferenceFieldUpdater
```

Kapan pakai Atomic classes?

- ingin API siap pakai,
- readability penting,
- tidak perlu akses field existing,
- cocok untuk counter/reference sederhana.

Kapan pakai VarHandle?

- ingin atomic access ke field existing,
- membangun library/concurrent structure,
- ingin menghindari updater lama,
- butuh access mode tertentu,
- butuh generated/centralized access plan.

Contoh business code yang lebih baik pakai `AtomicInteger`:

```java
private final AtomicInteger retryCount = new AtomicInteger();

int next = retryCount.incrementAndGet();
```

Contoh framework/internal structure yang mungkin pakai VarHandle:

```java
private volatile Object state;
private static final VarHandle STATE = ...;

boolean transition(Object expected, Object next) {
    return STATE.compareAndSet(this, expected, next);
}
```

---

## 25. VarHandle dan Invariant Object

VarHandle bisa melewati setter biasa.

Artinya ia bisa merusak invariant jika digunakan sembarangan.

Contoh:

```java
public final class CaseStatusHolder {
    private volatile String status;

    public void submit() {
        if (!"DRAFT".equals(status)) {
            throw new IllegalStateException("Only DRAFT can be submitted");
        }
        status = "SUBMITTED";
    }
}
```

Jika framework internal membuat VarHandle ke `status` dan melakukan:

```java
STATUS.setVolatile(holder, "APPROVED");
```

Maka invariant transition dilewati.

Rule:

```text
VarHandle should be used to implement invariant-preserving operations,
not to bypass the operations that preserve invariants.
```

Lebih baik:

```java
public boolean transition(String expected, String next) {
    validateTransition(expected, next);
    return STATUS.compareAndSet(this, expected, next);
}
```

VarHandle tetap private implementation detail.

---

## 26. MethodHandle/VarHandle dan JPMS

Di modular Java, access control dipengaruhi oleh module boundary.

Hal penting:

- `exports` membuat package visible untuk compile-time/public access.
- `opens` membuat package terbuka untuk deep reflection.
- `opens ... to module.name` membatasi deep reflection ke module tertentu.
- Method handle private lookup juga tunduk pada access/module rules.

Contoh module:

```java
module com.example.domain {
    exports com.example.domain.api;

    opens com.example.domain.internal.model to com.example.framework.mapper;
}
```

Interpretasi:

- API domain diekspor.
- Internal model tidak diekspor.
- Framework mapper diberi izin deep reflective/private access ke package internal model.

Tapi desain seperti ini harus sadar risiko:

```text
Semakin banyak opens, semakin lemah encapsulation runtime.
```

Guideline:

- jangan `open module` kecuali benar-benar perlu,
- prefer qualified `opens`,
- pisahkan DTO reflective-friendly dari domain invariant-rich,
- dokumentasikan package yang boleh direfleksi,
- jangan membuka seluruh internal domain hanya demi mapper yang malas.

---

## 27. MethodHandle dalam Framework Design

Misal Anda membuat mini validation framework:

```java
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Rule {
    String value();
}
```

Rule class:

```java
public final class CaseRules {
    @Rule("case-can-be-approved")
    public boolean canApprove(CaseData data) {
        return data.status().equals("SUBMITTED");
    }
}
```

Scanner:

```java
for (Method method : CaseRules.class.getDeclaredMethods()) {
    Rule rule = method.getAnnotation(Rule.class);
    if (rule == null) continue;

    MethodHandle handle = lookup.unreflect(method);
    registry.put(rule.value(), handle);
}
```

Runtime:

```java
MethodHandle ruleHandle = registry.get("case-can-be-approved");
boolean allowed = (boolean) ruleHandle.invoke(ruleInstance, data);
```

Production framework harus menambahkan:

- validation signature saat startup,
- error message jelas,
- cache immutable registry,
- no lookup in hot path,
- exception wrapping,
- module opens handling,
- generated metadata bila startup scanning mahal.

---

## 28. MethodHandle dan Code Generation

Generated code bisa memilih beberapa strategi:

### 28.1 Generate direct call

```java
return target.greet(input);
```

Paling cepat dan paling readable setelah generated source dibuka.

### 28.2 Generate reflection access

```java
method.invoke(target, input);
```

Lebih fleksibel tapi runtime overhead dan exception wrapping.

### 28.3 Generate method handle bootstrap/cache

```java
private static final MethodHandle GREET = ...;

return (String) GREET.invokeExact(target, input);
```

Cocok jika generator butuh dynamic-ish access tapi ingin handle caching dan typed invocation.

Decision:

| Situation | Better approach |
|---|---|
| Schema known at compile time | generated direct call |
| Metadata unknown until runtime | reflection scan + MethodHandle cache |
| Plugin loaded dynamically | MethodHandle/ServiceLoader/adapter |
| Need maximum readability | direct code |
| Need runtime composition | MethodHandle combinators |

Top engineer tidak langsung memilih “lebih canggih”. Pilih boundary yang paling sederhana dan paling defensible.

---

## 29. MethodHandle dan LambdaMetafactory

Lambda di Java modern biasanya diimplementasikan melalui `invokedynamic` dan bootstrap seperti `LambdaMetafactory`.

Anda bisa juga memakai `LambdaMetafactory` secara manual untuk mengubah method handle menjadi functional interface instance.

Namun ini advanced dan jarang perlu dalam application code.

Conceptual use case:

```text
Reflection scanner menemukan method getter.
Framework ingin membuat Function<T, R> yang memanggil getter.
Daripada Method.invoke terus-menerus, framework membuat lambda/function adapter.
```

Contoh konseptual, bukan pattern wajib:

```java
Function<Person, String> getter = buildFunctionFromMethodHandle(nameHandle);
```

Dalam banyak kasus, cukup gunakan:

- generated source,
- method reference biasa,
- cached MethodHandle,
- library mapper yang sudah matang.

Manual `LambdaMetafactory` layak untuk framework/library-level optimization, bukan business code biasa.

---

## 30. Failure Model MethodHandle dan VarHandle

### 30.1 Lookup failure

Kemungkinan:

- class tidak punya method/field,
- signature salah,
- access denied,
- module tidak membuka package,
- overload salah,
- primitive/wrapper mismatch,
- method berubah setelah refactor.

Exception umum:

```java
NoSuchMethodException
NoSuchFieldException
IllegalAccessException
```

Guideline:

- lakukan lookup di startup,
- fail fast,
- error message memuat target class, member name, expected signature,
- jangan lookup diam-diam saat request pertama.

### 30.2 Invocation failure

Kemungkinan:

- wrong method type,
- `ClassCastException`,
- `WrongMethodTypeException`,
- target method melempar exception,
- null receiver,
- wrong receiver class,
- argument count salah.

Guideline:

- validasi shape saat register,
- adaptasi handle ke common signature,
- wrap exception di boundary framework,
- test semua registered method saat startup.

### 30.3 VarHandle failure

Kemungkinan:

- coordinate salah,
- variable type salah,
- unsupported access mode,
- CAS gagal karena expected value tidak cocok,
- memory-ordering dipakai salah,
- invariant dilanggar.

Guideline:

- expose operation semantic, bukan expose VarHandle,
- jangan berikan VarHandle ke business code,
- CAS failure adalah normal branch, bukan selalu exception,
- test concurrent transition dengan stress test jika low-level.

---

## 31. Case Study: State Transition dengan VarHandle

Misal kita membuat object internal untuk state transition yang perlu atomic di memori.

> Catatan: Dalam enterprise system, state utama biasanya harus dikontrol database transaction. Contoh ini cocok untuk in-memory coordinator, actor state, cache state, atau runtime lifecycle state.

```java
public final class Lifecycle {
    private volatile State state = State.NEW;

    private static final VarHandle STATE;

    static {
        try {
            STATE = MethodHandles.lookup().findVarHandle(
                Lifecycle.class,
                "state",
                State.class
            );
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    public enum State {
        NEW,
        STARTING,
        RUNNING,
        STOPPING,
        STOPPED,
        FAILED
    }

    public State state() {
        return (State) STATE.getVolatile(this);
    }

    public boolean start() {
        return transition(State.NEW, State.STARTING);
    }

    public boolean markRunning() {
        return transition(State.STARTING, State.RUNNING);
    }

    public boolean stop() {
        State current = state();
        if (current == State.RUNNING) {
            return transition(State.RUNNING, State.STOPPING);
        }
        return false;
    }

    private boolean transition(State expected, State next) {
        validateTransition(expected, next);
        return STATE.compareAndSet(this, expected, next);
    }

    private static void validateTransition(State expected, State next) {
        boolean valid = switch (expected) {
            case NEW -> next == State.STARTING || next == State.FAILED;
            case STARTING -> next == State.RUNNING || next == State.FAILED;
            case RUNNING -> next == State.STOPPING || next == State.FAILED;
            case STOPPING -> next == State.STOPPED || next == State.FAILED;
            case STOPPED, FAILED -> false;
        };

        if (!valid) {
            throw new IllegalStateException("Invalid transition: " + expected + " -> " + next);
        }
    }
}
```

Good points:

- `VarHandle` private,
- invariant tetap lewat method,
- CAS dipakai untuk atomic transition,
- public API tetap semantic,
- caller tidak tahu ada VarHandle.

Bad alternative:

```java
public static final VarHandle STATE = ...; // buruk
```

Itu membocorkan implementation detail dan memungkinkan external code merusak invariant.

---

## 32. Case Study: MethodHandle-based Command Handler Registry

Target desain:

```java
public interface Command {}

public record SubmitApplication(String applicationId) implements Command {}
public record ApproveApplication(String applicationId) implements Command {}
```

Handler:

```java
public final class ApplicationCommandHandler {
    public void handle(SubmitApplication command) {
        System.out.println("Submit " + command.applicationId());
    }

    public void handle(ApproveApplication command) {
        System.out.println("Approve " + command.applicationId());
    }
}
```

Registry:

```java
public final class CommandHandlerRegistry {
    private final Object handler;
    private final Map<Class<?>, MethodHandle> routes;

    public CommandHandlerRegistry(Object handler) {
        this.handler = handler;
        this.routes = scan(handler.getClass());
    }

    public void dispatch(Command command) {
        MethodHandle handle = routes.get(command.getClass());
        if (handle == null) {
            throw new IllegalArgumentException("No handler for " + command.getClass().getName());
        }

        try {
            handle.invoke(handler, command);
        } catch (RuntimeException | Error e) {
            throw e;
        } catch (Throwable e) {
            throw new CommandDispatchException("Command handler failed: " + command.getClass().getName(), e);
        }
    }

    private static Map<Class<?>, MethodHandle> scan(Class<?> handlerType) {
        try {
            MethodHandles.Lookup lookup = MethodHandles.lookup();
            Map<Class<?>, MethodHandle> result = new HashMap<>();

            for (Method method : handlerType.getDeclaredMethods()) {
                if (!method.getName().equals("handle")) continue;
                if (method.getParameterCount() != 1) continue;
                if (method.getReturnType() != void.class) continue;

                Class<?> commandType = method.getParameterTypes()[0];
                if (!Command.class.isAssignableFrom(commandType)) continue;

                MethodHandle raw = lookup.unreflect(method);

                MethodHandle adapted = raw.asType(
                    MethodType.methodType(void.class, handlerType, Command.class)
                );

                MethodHandle previous = result.put(commandType, adapted);
                if (previous != null) {
                    throw new IllegalStateException("Duplicate handler for " + commandType.getName());
                }
            }

            return Map.copyOf(result);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException("Cannot scan handler", e);
        }
    }
}
```

Support exception:

```java
public final class CommandDispatchException extends RuntimeException {
    public CommandDispatchException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

What this teaches:

- reflection used for discovery,
- method handle used for execution,
- registry immutable after startup,
- duplicate handler detected early,
- dynamic invocation boundary wrapped,
- public API remains simple.

Production improvements:

- support inheritance/assignable dispatch carefully,
- handle module access,
- support annotation-based naming,
- validate ambiguity,
- avoid accidental private method access unless intended,
- add startup diagnostics.

---

## 33. Security and Encapsulation Risk

MethodHandle/VarHandle are not “hacks”. They obey access rules.

But within authorized lookup, they can still become dangerous if you expose them incorrectly.

Bad:

```java
public MethodHandle internalPasswordGetter() { ... }
```

Bad:

```java
public VarHandle statusFieldHandle() { ... }
```

Better:

```java
public boolean canTransitionTo(Status next) { ... }
public void transitionTo(Status next) { ... }
```

Framework boundary rule:

```text
Handles are implementation details.
Domain operations are public semantics.
```

For compliance/regulatory systems, this distinction matters:

- audit trail must record semantic operation, not raw field mutation,
- authorization must guard business action, not only endpoint,
- invariant must live in domain/service operation,
- framework bypass must be intentional and documented,
- generated code must not become invisible privilege escalation.

---

## 34. API Design Rules

### Rule 1: Do not expose handles from domain API

```java
// avoid
public VarHandle statusHandle();
public MethodHandle approveHandle();
```

Expose behavior:

```java
public ApprovalResult approve(ApprovalCommand command);
```

### Rule 2: Cache handles at boundary

```java
private static final MethodHandle HANDLE = ...;
```

or registry:

```java
private final Map<Class<?>, MethodHandle> handlers;
```

Do not lookup repeatedly.

### Rule 3: Fail fast during initialization

If method signature is wrong, fail at startup.

Do not wait for production request.

### Rule 4: Wrap dynamic failure with domain/framework context

Bad:

```text
WrongMethodTypeException
```

Better:

```text
Cannot invoke command handler ApplicationCommandHandler.handle(SubmitApplication): expected (Handler, Command)void but got ...
```

### Rule 5: Prefer direct/generate code when possible

MethodHandle is not a replacement for good architecture.

---

## 35. Common Anti-Patterns

### 35.1 Using MethodHandle to avoid designing interface

Bad:

```text
Everything is Object + method name + MethodHandle.
```

Better:

```java
interface CaseRule {
    RuleDecision evaluate(CaseContext context);
}
```

Use method handle only when dynamic discovery is a real requirement.

### 35.2 Lookup in hot path

Bad:

```java
handle = lookup.findVirtual(...); // every request
```

Better:

```java
handle = buildOnceAtStartup();
```

### 35.3 Exposing VarHandle publicly

Bad because external code can bypass invariants.

### 35.4 Using VarHandle for ordinary business fields

If state is normal object state, just use methods, locks, transactions, or immutable design.

### 35.5 Ignoring module boundary

Works on classpath, fails on module path.

### 35.6 Overusing combinators

MethodHandle combinators can create unreadable runtime logic.

If a generated class would be clearer, generate source.

---

## 36. MethodHandle/VarHandle in the Bigger Series Map

Hubungan dengan part lain:

```text
OOP model:
  class, object, method, field, constructor
        ↓
Reflection:
  inspect metadata dynamically
        ↓
MethodHandle:
  execute method/constructor/field-like operation dynamically but typed
        ↓
VarHandle:
  access variable dynamically with access modes
        ↓
Code generation:
  avoid dynamic overhead by generating direct code when possible
        ↓
JPMS:
  control who may access what at module/package boundary
```

MethodHandle/VarHandle adalah alat bridge antara:

- static Java code,
- reflection framework,
- generated adapter,
- dynamic runtime,
- low-level JVM access.

---

## 37. Practical Checklist

Sebelum memakai `MethodHandle`:

- Apakah direct call/interface tidak cukup?
- Apakah dynamic discovery benar-benar diperlukan?
- Apakah handle akan dicache?
- Apakah signature divalidasi saat startup?
- Apakah error message cukup jelas?
- Apakah access/module boundary jelas?
- Apakah invocation exception dibungkus di boundary?
- Apakah benchmark dilakukan dengan benar jika alasan utamanya performa?

Sebelum memakai `VarHandle`:

- Apakah variable access biasa tidak cukup?
- Apakah atomic/volatile/acquire-release access benar-benar diperlukan?
- Apakah invariant tetap dijaga?
- Apakah handle private?
- Apakah CAS failure ditangani sebagai normal condition?
- Apakah concurrency semantics sudah dipahami?
- Apakah alternative `Atomic*`, lock, transaction, atau immutable design lebih sederhana?

---

## 38. Ringkasan Mental Model

`MethodHandle`:

```text
typed executable reference to operation
```

`MethodType`:

```text
runtime object representing parameter and return types
```

`Lookup`:

```text
capability object carrying access rights
```

`invoke`:

```text
flexible dynamic invocation
```

`invokeExact`:

```text
exact call-site type contract
```

`VarHandle`:

```text
typed reference to variable with access modes
```

Reflection vs handles:

```text
Reflection discovers and describes.
MethodHandle executes dynamically.
VarHandle accesses variables dynamically/atomically.
```

Top-level design principle:

> Jangan gunakan MethodHandle/VarHandle untuk membuat kode terlihat pintar. Gunakan ketika Anda sedang membangun runtime boundary yang memang membutuhkan dynamic access, typed executable plan, atomic variable access, atau generated-framework integration.

---

## 39. Latihan

### Latihan 1 — Getter Accessor Cache

Buat utility yang:

- menerima class,
- mencari public no-arg method yang namanya diawali `get` atau record accessor,
- membuat `MethodHandle`,
- menyimpan dalam map immutable,
- dapat mengambil nilai property dari object.

Pastikan:

- lookup hanya saat startup,
- method return `void` ditolak,
- overloaded getter ditolak,
- error message jelas.

### Latihan 2 — Command Dispatcher

Implementasikan command dispatcher berbasis `MethodHandle`:

- handler method bernama `handle`,
- return type harus `void`,
- parameter harus subtype `Command`,
- duplicate command handler gagal saat startup,
- dispatch command unknown memberi error jelas.

### Latihan 3 — Atomic Lifecycle

Buat lifecycle object dengan `VarHandle`:

- state `NEW`, `STARTING`, `RUNNING`, `STOPPING`, `STOPPED`, `FAILED`,
- transition menggunakan CAS,
- invalid transition throw exception,
- CAS false berarti ada concurrent transition,
- `VarHandle` tidak diekspos.

### Latihan 4 — Reflection to MethodHandle Migration

Ambil kode reflection invoke sederhana:

```java
method.invoke(target, arg);
```

Migrasikan ke:

```java
MethodHandle cached = lookup.unreflect(method).asType(...);
cached.invoke(target, arg);
```

Bandingkan:

- readability,
- error handling,
- startup validation,
- runtime invocation path.

---

## 40. Kesalahan Berpikir yang Harus Dihindari

1. **“MethodHandle adalah reflection yang lebih cepat.”**  
   Tidak selalu. Ia adalah model dynamic invocation yang berbeda dan lebih typed.

2. **“invokeExact selalu lebih baik.”**  
   Ia lebih ketat, tapi bisa memperumit adapter dan call-site type.

3. **“VarHandle adalah pengganti setter.”**  
   Salah. VarHandle adalah low-level variable access. Setter/domain method menjaga invariant.

4. **“Kalau bisa private lookup, berarti boleh akses private field.”**  
   Secara teknis mungkin, secara desain belum tentu benar.

5. **“Framework boleh bypass semua boundary.”**  
   Framework yang baik justru membuat boundary eksplisit, terdokumentasi, dan dapat diaudit.

---

## 41. Penutup

Bagian ini memperkenalkan `MethodHandle` dan `VarHandle` sebagai alat dynamic access yang lebih dekat ke JVM dibanding reflection klasik.

Keduanya sangat kuat, tetapi bukan alat default untuk business application biasa.

Gunakan ketika Anda membangun:

- framework,
- mapper,
- serializer,
- validator,
- rule engine,
- command dispatcher,
- plugin runtime,
- generated-code bridge,
- concurrent low-level structure.

Untuk domain model dan application service biasa, desain yang lebih baik biasanya tetap:

- interface jelas,
- method semantic,
- invariant terlindungi,
- module boundary ketat,
- generated/direct code jika memungkinkan.

Di part berikutnya kita akan masuk ke **Annotation Design**: bagaimana mendesain annotation sebagai metadata/DSL yang tidak berubah menjadi hidden coupling dan configuration trap.

---

## Referensi

- Java SE 25 API — `java.lang.invoke.MethodHandle`
- Java SE 25 API — `java.lang.invoke.MethodHandles`
- Java SE 25 API — `java.lang.invoke.MethodHandles.Lookup`
- Java SE 25 API — `java.lang.invoke.MethodType`
- Java SE 25 API — `java.lang.invoke.VarHandle`
- OpenJDK JEP 193 — Variable Handles
- Java Language Specification Java SE 25
- Java Virtual Machine Specification Java SE 25

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-oop-functional-reflection-codegen-modules-part-019](./learn-java-oop-functional-reflection-codegen-modules-part-019.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-oop-functional-reflection-codegen-modules-part-021.md](./learn-java-oop-functional-reflection-codegen-modules-part-021.md)
