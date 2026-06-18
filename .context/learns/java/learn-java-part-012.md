# Learn Java Part 012 — JVM Internal: Dari Class File sampai JIT

> Target: Java hingga versi 25  
> Audience: software engineer yang ingin memahami Java bukan hanya sebagai bahasa, tetapi sebagai runtime system yang dinamis, teroptimasi, observable, dan production-grade.  
> Fokus: source code Java → bytecode → class file → class loading/linking/initialization → interpreter → profiling → JIT → optimized native code → deoptimization → AOT cache.

---

## 0. Posisi Bagian Ini dalam Kurikulum

Bagian sebelumnya membahas:

- fondasi bahasa Java;
- object model;
- type system;
- modern language features;
- functional programming;
- collections;
- error handling;
- concurrency;
- I/O, networking, serialization;
- text, Unicode, locale, date-time.

Bagian ini turun satu lapisan lebih rendah: **bagaimana Java benar-benar dijalankan oleh JVM**.

Banyak engineer Java bisa menulis aplikasi Spring Boot, menggunakan Hibernate, Kafka client, atau virtual threads. Tetapi engineer yang kuat memahami bahwa di balik itu semua ada mekanisme runtime:

```text
.java source
  ↓ javac
.class file
  ↓ class loader
runtime Class metadata
  ↓ verifier + linker
verified executable bytecode
  ↓ interpreter
profiled execution
  ↓ JIT compiler
optimized native machine code
  ↓ assumptions invalid?
deoptimization back to interpreter
```

Mental model ini penting karena banyak masalah production tidak bisa dijelaskan dari source code saja:

- startup lambat;
- warmup lambat;
- CPU spike setelah deployment;
- `ClassNotFoundException`;
- `NoClassDefFoundError`;
- `NoSuchMethodError`;
- `UnsupportedClassVersionError`;
- `VerifyError`;
- `OutOfMemoryError: Metaspace`;
- latency spike karena JIT/GC/safepoint;
- performance benchmark palsu;
- reflective framework startup cost;
- classloader leak;
- agent/instrumentation conflict;
- lambdas/string concat menghasilkan bytecode yang tidak terlihat eksplisit di source;
- perubahan dependency binary-compatible secara source tetapi tidak secara runtime.

Bagian ini bertujuan membuatmu bisa menjawab pertanyaan:

> “Ketika saya menjalankan `java -jar app.jar`, pekerjaan apa saja yang dilakukan JVM sebelum request pertama berhasil diproses?”

---

## 1. Peta Besar JVM Execution

### 1.1 Java source bukan yang dieksekusi JVM secara langsung

JVM tidak mengeksekusi file `.java`.

Jalur normalnya:

```text
User writes:
  src/main/java/com/example/App.java

Compiler produces:
  target/classes/com/example/App.class

JVM consumes:
  binary class file

Execution happens as:
  bytecode interpreted and/or compiled to native code at runtime
```

`javac` adalah compiler dari source Java ke **class file**, bukan compiler langsung ke executable native seperti C/C++ tradisional.

Hasil `javac` adalah bytecode dan metadata yang mengikuti **Java Virtual Machine Specification**.

### 1.2 Kenapa Java memakai bytecode?

Bytecode memberi beberapa keuntungan:

1. **Portability**  
   Class file yang sama dapat dijalankan di JVM berbeda selama compatible.

2. **Runtime optimization**  
   JVM dapat melihat perilaku aplikasi saat berjalan dan mengoptimalkan hot path berdasarkan data aktual.

3. **Dynamic loading**  
   Class tidak harus diketahui semua di compile time. Framework, plugin, agent, reflection, dan dynamic proxy bisa bekerja.

4. **Verification**  
   JVM dapat memverifikasi class file sebelum dijalankan.

5. **Language neutrality**  
   JVM tidak hanya menjalankan Java. Kotlin, Scala, Groovy, Clojure, JRuby, dan bahasa lain dapat menghasilkan class file.

### 1.3 Perbedaan compiler Java dan JVM

| Komponen | Tugas utama | Input | Output |
|---|---|---|---|
| `javac` | Compile source ke class file | `.java` | `.class` |
| Class loader | Menemukan dan mendefinisikan class | `.class` bytes | runtime `Class<?>` |
| Verifier | Memastikan bytecode aman/valid | class file | verified class |
| Interpreter | Menjalankan bytecode awal | bytecode | execution |
| JIT compiler | Compile hot bytecode ke native code | bytecode + profile | machine code |
| GC | Mengelola object memory | heap graph | reclaimed memory |
| JFR/tools | Observability runtime | runtime events | diagnostics |

### 1.4 JVM adalah specification, HotSpot adalah implementation

Istilah “JVM” sering dipakai longgar.

Secara presisi:

- **JVM Specification** mendefinisikan behavior virtual machine.
- **HotSpot JVM** adalah implementasi JVM utama di OpenJDK/Oracle JDK.
- Implementasi lain dapat ada, selama mengikuti specification.

Ketika kita membahas:

- class file format;
- runtime data areas;
- bytecode instruction set;
- loading/linking/initialization;

itu mostly specification-level.

Ketika kita membahas:

- C1/C2 compiler;
- code cache;
- tiered compilation;
- compressed oops;
- metaspace implementation;
- JFR events;
- HotSpot flags;

itu mostly HotSpot implementation-level.

Engineer yang kuat tahu membedakan:

```text
"Java guarantees this"
vs
"HotSpot usually implements this like this"
vs
"This is an optimization and can change"
```

---

## 2. Source Code ke Class File

### 2.1 Contoh program kecil

Buat file:

```java
// App.java
public class App {
    public static void main(String[] args) {
        int x = 10;
        int y = 20;
        System.out.println(add(x, y));
    }

    static int add(int a, int b) {
        return a + b;
    }
}
```

Compile:

```bash
javac App.java
```

Hasil:

```text
App.class
```

Run:

```bash
java App
```

Disassemble:

```bash
javap -c -v App
```

Kira-kira bytecode method `add`:

```text
static int add(int, int);
  Code:
     0: iload_0
     1: iload_1
     2: iadd
     3: ireturn
```

Ini terlihat sederhana, tetapi mengandung mental model penting:

```text
local variable 0 -> push ke operand stack
local variable 1 -> push ke operand stack
iadd             -> pop dua int, push hasil
ireturn          -> return int dari operand stack
```

JVM instruction model bersifat **stack-based**, bukan register-based.

### 2.2 `javac` tidak melakukan semua optimasi

Sebagian engineer mengira compiler Java melakukan optimasi besar seperti C++ compiler.

Tidak begitu.

`javac` terutama bertugas:

- parsing source;
- type checking;
- flow analysis;
- desugaring sebagian fitur;
- menghasilkan class file valid;
- menulis metadata;
- menjalankan annotation processing bila enabled.

Optimasi besar dilakukan JVM pada runtime melalui JIT.

Contoh:

```java
int result = service.calculate(request);
```

Di compile time, `javac` tidak tahu:

- implementasi runtime `service` sebenarnya apa;
- method mana yang paling sering dipanggil;
- branch mana yang paling sering benar;
- object mana yang escape atau tidak;
- class apa yang akan diload nanti;
- apakah callsite bisa di-inline secara aman;
- apakah lock bisa dieliminasi.

JVM bisa mengetahui sebagian dari itu saat program berjalan.

### 2.3 Tool penting untuk melihat hasil compile

#### `javap`

`javap` adalah disassembler class file.

Perintah umum:

```bash
javap App
javap -c App
javap -v App
javap -p -c -v App
```

Makna:

| Flag | Makna |
|---|---|
| `-c` | tampilkan bytecode |
| `-v` | verbose: constant pool, attributes, stack map, version |
| `-p` | tampilkan private member |
| `-s` | tampilkan descriptor |
| `-l` | tampilkan line/local variable table bila ada |

Gunakan `javap` untuk menjawab:

- fitur Java modern dikompilasi menjadi apa?
- lambda menjadi anonymous class atau `invokedynamic`?
- `switch` menjadi `tableswitch` atau `lookupswitch`?
- record menghasilkan method apa saja?
- generics tersisa di runtime atau erased?
- synthetic/bridge method muncul di mana?
- annotation tersimpan sebagai attribute apa?

#### `jar`

Untuk melihat isi artifact:

```bash
jar --list --file app.jar
jar --describe-module --file app.jar
```

#### `jdeps`

Untuk dependency pada module/package:

```bash
jdeps --multi-release 25 --class-path libs/* app.jar
jdeps --module-path mods --module com.example.app
```

#### `jcmd`

Untuk runtime process:

```bash
jcmd
jcmd <pid> VM.version
jcmd <pid> VM.flags
jcmd <pid> VM.classloader_stats
jcmd <pid> Compiler.codecache
jcmd <pid> Compiler.queue
jcmd <pid> Thread.print
```

---

## 3. Anatomy Class File

### 3.1 Class file adalah binary contract

Class file bukan sekadar bytecode. Ia adalah struktur binary yang memuat:

- magic number;
- version;
- constant pool;
- access flags;
- class identity;
- superclass;
- interfaces;
- fields;
- methods;
- attributes.

Secara konseptual:

```text
ClassFile {
  magic;
  minor_version;
  major_version;
  constant_pool;
  access_flags;
  this_class;
  super_class;
  interfaces;
  fields;
  methods;
  attributes;
}
```

### 3.2 Magic number

Class file Java valid dimulai dengan magic number:

```text
0xCAFEBABE
```

Kalau file bukan class file valid, JVM/class tools akan menolak.

### 3.3 Version

Class file punya major/minor version.

Contoh problem:

```text
java.lang.UnsupportedClassVersionError:
  class file has wrong version
```

Artinya class file dikompilasi untuk versi Java lebih baru daripada runtime yang dipakai.

Mental model:

```text
javac --release 25  -> class file Java 25
java 21             -> tidak bisa menjalankan class file Java 25
```

Prinsip production:

- build target harus eksplisit;
- runtime version harus diketahui;
- CI harus enforce `--release`;
- jangan hanya mengandalkan `sourceCompatibility`.

### 3.4 Constant pool

Constant pool adalah tabel symbolic constants yang dipakai class file.

Isinya bisa meliputi:

- class reference;
- field reference;
- method reference;
- interface method reference;
- string;
- integer/float/long/double;
- name-and-type;
- method handle;
- method type;
- dynamic constant;
- invokedynamic bootstrap info;
- module/package info.

Contoh bytecode:

```text
getstatic     #7  // Field java/lang/System.out:Ljava/io/PrintStream;
invokevirtual #13 // Method java/io/PrintStream.println:(I)V
```

Angka `#7` dan `#13` menunjuk ke entry constant pool.

Mental model:

```text
Bytecode instruction does not store full symbolic name inline.
It stores index into constant pool.
```

### 3.5 Descriptor

JVM memakai descriptor, bukan syntax Java source.

Contoh field descriptor:

| Java type | JVM descriptor |
|---|---|
| `int` | `I` |
| `long` | `J` |
| `double` | `D` |
| `boolean` | `Z` |
| `void` | `V` |
| `String` | `Ljava/lang/String;` |
| `int[]` | `[I` |
| `String[]` | `[Ljava/lang/String;` |

Method descriptor:

```java
String format(int x, long y)
```

Menjadi:

```text
(IJ)Ljava/lang/String;
```

Mental model:

```text
(parameter types)return type
```

### 3.6 Signature attribute dan generics

Generics Java memakai **type erasure**.

Descriptor runtime method bisa erased:

```java
List<String> names()
```

Descriptor dasar:

```text
()Ljava/util/List;
```

Generic info bisa tetap ada sebagai metadata di `Signature` attribute:

```text
()Ljava/util/List<Ljava/lang/String;>;
```

Tetapi JVM execution tidak menggunakan `List<String>` sebagai runtime type berbeda dari `List<Integer>`.

Akibatnya:

- runtime cast generic terbatas;
- reflection bisa membaca sebagian generic signature;
- bytecode execution tetap berdasarkan erased type;
- bridge method bisa dibuat untuk menjaga polymorphism.

### 3.7 Code attribute

Method yang punya body memiliki `Code` attribute.

Isi penting:

- `max_stack`;
- `max_locals`;
- bytecode array;
- exception table;
- nested attributes seperti:
  - `LineNumberTable`;
  - `LocalVariableTable`;
  - `StackMapTable`.

Contoh:

```text
Code:
  stack=2, locals=2, args_size=2
     0: iload_0
     1: iload_1
     2: iadd
     3: ireturn
```

Maknanya:

- operand stack maksimum 2 slot;
- local variable array berisi 2 slot;
- method menerima 2 argument;
- bytecode menjalankan operasi tambah int.

### 3.8 Attributes sebagai extension mechanism

Class file berkembang selama puluhan tahun tanpa merusak struktur dasar karena ada attribute.

Contoh attribute:

| Attribute | Fungsi |
|---|---|
| `Code` | body method |
| `LineNumberTable` | mapping bytecode ke source line |
| `LocalVariableTable` | nama local variable untuk debug |
| `StackMapTable` | metadata verifier |
| `Signature` | generic signature |
| `RuntimeVisibleAnnotations` | annotation runtime |
| `InnerClasses` | nested/inner metadata |
| `EnclosingMethod` | local/anonymous class context |
| `BootstrapMethods` | bootstrap untuk `invokedynamic`/dynamic constants |
| `Module` | JPMS metadata |
| `Record` | record component metadata |
| `PermittedSubclasses` | sealed class metadata |

Mental model:

```text
Java language features often become class-file attributes + normal methods/fields.
```

---

## 4. Bytecode Mental Model

### 4.1 JVM adalah stack machine

Sebagian besar bytecode bekerja pada operand stack.

Contoh Java:

```java
int z = x + y;
```

Bytecode:

```text
iload_1
iload_2
iadd
istore_3
```

Artinya:

```text
push local[1]
push local[2]
pop 2 int, add, push result
pop result, store to local[3]
```

### 4.2 Frame

Setiap method invocation membuat frame.

Frame berisi:

- local variables array;
- operand stack;
- reference ke runtime constant pool;
- informasi return/exception handling.

Konseptual:

```text
Thread stack
  frame: main()
    locals
    operand stack
  frame: service()
    locals
    operand stack
  frame: repository()
    locals
    operand stack
```

Kalau call chain terlalu dalam:

```text
StackOverflowError
```

### 4.3 Local variables bukan “nama variable”

Bytecode local variable slot berbasis indeks.

Contoh instance method:

```java
class Counter {
    int value;

    int add(int delta) {
        return value + delta;
    }
}
```

Slot local:

| Slot | Isi |
|---|---|
| 0 | `this` |
| 1 | `delta` |

Static method tidak punya `this`.

Untuk `long` dan `double`, value memakai dua slot.

### 4.4 Operand stack bukan heap

Operand stack menyimpan value sementara saat instruksi dijalankan.

Ia bukan heap object storage.

Reference object di operand stack adalah pointer/reference ke object di heap.

```text
operand stack:
  reference to String object

heap:
  actual String object
```

### 4.5 Instruction categories

Bytecode instruction dapat dikelompokkan:

| Kategori | Contoh |
|---|---|
| Load/store | `iload`, `aload`, `istore`, `astore` |
| Constant push | `iconst_0`, `ldc`, `bipush`, `sipush` |
| Arithmetic | `iadd`, `lmul`, `ddiv` |
| Conversion | `i2l`, `d2i` |
| Object creation | `new`, `newarray`, `anewarray` |
| Field access | `getfield`, `putfield`, `getstatic`, `putstatic` |
| Method invocation | `invokestatic`, `invokevirtual`, `invokeinterface`, `invokespecial`, `invokedynamic` |
| Control flow | `if_icmpge`, `goto`, `tableswitch`, `lookupswitch` |
| Exception | `athrow` |
| Synchronization | `monitorenter`, `monitorexit` |
| Return | `ireturn`, `areturn`, `return` |

### 4.6 Primitive instruction families

Bytecode instruction sering punya prefix type:

| Prefix | Type |
|---|---|
| `i` | int, byte, short, char, boolean often represented as int |
| `l` | long |
| `f` | float |
| `d` | double |
| `a` | reference |

Tidak ada instruction khusus `boolean add` atau `byte add`. Banyak operasi kecil dipromosikan ke `int`.

### 4.7 Method invocation opcodes

#### `invokestatic`

Untuk static method.

```java
Math.max(a, b)
```

#### `invokevirtual`

Untuk instance method virtual dispatch.

```java
user.name()
```

Dispatch berdasarkan runtime class receiver.

#### `invokeinterface`

Untuk interface method.

```java
list.size()
```

Receiver bisa class apa pun yang implement interface.

#### `invokespecial`

Untuk special invocation:

- constructor;
- private method;
- explicit `super.method()`;
- beberapa special resolution case.

#### `invokedynamic`

Untuk call site yang linkage-nya ditentukan oleh bootstrap method.

Dipakai oleh:

- lambda;
- method reference;
- string concatenation modern;
- dynamic language runtimes;
- beberapa framework/instrumentation.

### 4.8 Object creation bytecode

Java:

```java
User user = new User("A");
```

Bytecode pattern biasanya:

```text
new           #User
dup
ldc           #String A
invokespecial #User.<init>
astore_1
```

Kenapa ada `dup`?

Karena:

- `new` membuat uninitialized object reference;
- `dup` menggandakan reference agar constructor bisa dipanggil dan hasilnya tetap tersedia untuk disimpan;
- `invokespecial <init>` menginisialisasi object;
- `astore` menyimpan reference ke local variable.

### 4.9 Exception handling di bytecode

`try-catch` tidak selalu terlihat sebagai instruksi khusus di main path.

Class file menyimpan **exception table**:

```text
from    to    target   type
0       10    20       java/lang/Exception
```

Artinya:

- jika exception terjadi antara bytecode index 0 sampai 10;
- dan type compatible;
- control jump ke handler target 20.

Mental model:

```text
Normal path tetap lurus.
Exception path dikelola metadata table.
```

### 4.10 `switch`: `tableswitch` vs `lookupswitch`

JVM punya dua instruction utama untuk switch integer-like:

- `tableswitch`: cocok untuk dense range;
- `lookupswitch`: cocok untuk sparse keys.

Contoh:

```java
switch (statusCode) {
    case 200 -> ...
    case 201 -> ...
    case 202 -> ...
}
```

Bisa jadi `tableswitch`.

```java
switch (statusCode) {
    case 200 -> ...
    case 404 -> ...
    case 500 -> ...
}
```

Bisa jadi `lookupswitch`.

Untuk `String switch`, compiler menghasilkan kombinasi:

- hash code;
- equals check;
- switch integer.

Ini penting karena source sederhana bisa menghasilkan bytecode cukup panjang.

---

## 5. Runtime Data Areas

JVM Specification mendefinisikan beberapa runtime data areas.

### 5.1 Per-thread areas

#### PC register

Setiap thread punya program counter.

Ia menunjuk instruction JVM yang sedang dieksekusi untuk thread tersebut.

#### JVM stack

Setiap thread punya stack yang berisi frame method invocation.

Failure umum:

```text
java.lang.StackOverflowError
```

atau jika stack tidak bisa dialokasikan:

```text
OutOfMemoryError
```

#### Native method stack

Dipakai untuk native method.

Misalnya JNI/FFM/native libraries.

### 5.2 Shared areas

#### Heap

Tempat object dan array dialokasikan.

Failure:

```text
java.lang.OutOfMemoryError: Java heap space
```

#### Method area

Specification menyebut method area sebagai area shared untuk per-class structure.

Di HotSpot modern, banyak metadata class berada di **Metaspace**.

Failure umum:

```text
java.lang.OutOfMemoryError: Metaspace
```

#### Runtime constant pool

Bagian dari per-class runtime data.

Berisi symbolic references dan constants yang dipakai execution/linking.

### 5.3 Frame detail

Frame berisi:

```text
Frame {
  local variables[]
  operand stack
  runtime constant pool reference
  return info
}
```

Hal penting:

- frame dibuat saat method dipanggil;
- frame dihancurkan saat method selesai;
- recursion membuat banyak frame;
- local variable primitive/reference ada di frame;
- object yang direferensikan tetap di heap.

### 5.4 Heap vs stack misunderstanding

Kalimat “object di stack” sering misleading.

JVM semantics:

- object dan array berada di heap;
- local variable slot bisa menyimpan reference;
- JIT bisa melakukan escape analysis dan scalar replacement sehingga object allocation dapat dieliminasi secara optimized implementation detail.

Jangan membuat desain berdasarkan asumsi “object pasti di stack” kecuali sedang membahas optimization secara hati-hati.

---

## 6. Class Loading

### 6.1 Loading, linking, initialization

JVM lifecycle class:

```text
Loading
  ↓
Linking
  ├─ Verification
  ├─ Preparation
  └─ Resolution
  ↓
Initialization
```

Loading = menemukan binary representation dan membuat runtime class/interface.

Linking = menggabungkan class ke runtime state agar bisa dieksekusi.

Initialization = menjalankan class initialization method, yaitu static field initializer dan static block.

### 6.2 Class loading lazy by design

JVM tidak harus meload semua class saat aplikasi start.

Class bisa diload saat:

- pertama kali direferensikan;
- method tertentu dipanggil;
- reflection;
- framework scanning;
- service provider discovery;
- dynamic proxy/instrumentation;
- deserialization;
- lambda/metafactory linkage;
- classloader eksplisit.

Ini memberi fleksibilitas tetapi juga membuat production behavior dinamis.

### 6.3 Built-in class loaders

Modern Java memiliki built-in loaders seperti:

| Loader | Peran |
|---|---|
| Bootstrap class loader | memuat core runtime classes |
| Platform class loader | memuat platform modules/classes |
| Application/System class loader | memuat application classpath/module path |
| Custom class loader | plugin, app server, framework, test runner, agent |

Nama lama “extension class loader” relevan untuk Java lama, tetapi modern JPMS mengganti banyak model tersebut.

### 6.4 Parent delegation

Class loader umumnya memakai delegation:

```text
Application loader
  asks Platform loader
    asks Bootstrap loader
```

Jika parent menemukan class, child tidak mendefinisikan duplicate class itu.

Tujuan:

- core class tidak mudah diganti;
- consistency;
- security;
- sharing.

Namun custom class loader bisa memakai strategi berbeda.

Contoh app server/plugin kadang child-first untuk isolasi dependency.

### 6.5 Class identity

Di JVM, identity class bukan hanya binary name.

Class identity secara praktis:

```text
(binary name, defining class loader)
```

Dua class dengan nama sama tetapi classloader berbeda adalah type berbeda.

Ini menjelaskan error seperti:

```text
ClassCastException: com.example.Plugin cannot be cast to com.example.Plugin
```

Terdengar absurd, tetapi bisa terjadi karena:

```text
Plugin loaded by loader A
Plugin loaded by loader B
```

### 6.6 Common class loading errors

#### `ClassNotFoundException`

Checked exception.

Biasanya muncul saat code secara eksplisit meminta load class:

```java
Class.forName("com.example.Missing")
```

Makna:

```text
Requested class name cannot be found by the relevant loader.
```

#### `NoClassDefFoundError`

Error runtime.

Bisa terjadi saat class pernah diketahui compile-time tetapi tidak tersedia runtime, atau initialization sebelumnya gagal.

Contoh:

```text
java.lang.NoClassDefFoundError: com/example/Foo
```

#### `NoSuchMethodError`

Biasanya dependency mismatch.

Compile dengan versi library yang punya method, runtime memakai versi library yang tidak punya method.

```text
compiled against lib v2
runtime loads lib v1
```

#### `NoSuchFieldError`

Sama seperti method error tetapi field.

#### `IncompatibleClassChangeError`

Class/interface/member berubah secara binary-incompatible.

#### `UnsupportedClassVersionError`

Class file dibuat untuk versi lebih baru dari JVM runtime.

#### `LinkageError`

Family error untuk problem linking.

### 6.7 Troubleshooting class loading

Command penting:

```bash
java -verbose:class -jar app.jar
```

atau unified logging:

```bash
java -Xlog:class+load=info -jar app.jar
java -Xlog:class+load,class+unload=info -jar app.jar
```

Untuk process berjalan:

```bash
jcmd <pid> VM.classloader_stats
jcmd <pid> VM.classloaders
```

Checklist:

- dependency tree di build tool;
- classpath order;
- duplicate JAR;
- shaded dependency;
- multi-release JAR;
- module path vs classpath;
- container image runtime JDK version;
- framework devtools/restart classloader;
- app server shared library;
- test runtime berbeda dari production runtime.

---

## 7. Linking: Verification, Preparation, Resolution

### 7.1 Verification

Verifier memastikan class file valid dan aman menurut rules JVM.

Tujuannya:

- operand stack type consistent;
- local variable use valid;
- branch target valid;
- method return type valid;
- object initialized sebelum dipakai sebagai initialized object;
- access control respected;
- final rules respected;
- bytecode tidak merusak memory safety.

Jika gagal:

```text
java.lang.VerifyError
```

Contoh penyebab:

- bytecode generated/instrumented salah;
- library bytecode incompatible;
- tool lama tidak mendukung class file modern;
- agent memodifikasi class secara tidak valid.

### 7.2 StackMapTable

Modern class file memakai `StackMapTable` untuk membantu verifier.

Ia menyimpan type state pada titik-titik tertentu agar verification lebih efisien.

Jika bytecode transformer mengubah control flow tetapi tidak memperbarui stack map, bisa terjadi:

```text
VerifyError: Inconsistent stackmap frames
```

Ini penting untuk engineer yang memakai:

- ASM;
- Byte Buddy;
- Java agent;
- instrumentation;
- coverage tool;
- mocking tool;
- APM agent.

### 7.3 Preparation

Preparation mengalokasikan storage untuk static fields dan memberi default value.

Contoh:

```java
class Config {
    static int port = computePort();
}
```

Pada preparation:

```text
Config.port = 0
```

Pada initialization:

```text
Config.port = computePort()
```

Jadi static field initializer belum dijalankan pada preparation.

### 7.4 Resolution

Resolution mengubah symbolic reference menjadi direct reference.

Contoh symbolic reference:

```text
java/io/PrintStream.println:(I)V
```

Saat resolved, JVM menemukan target actual method/field/class.

Resolution bisa dilakukan lazy.

Akibatnya, error linking bisa muncul bukan saat startup, tetapi saat code path tertentu pertama kali dieksekusi.

### 7.5 Access control

Selama linking/resolution, JVM memastikan access rule:

- public;
- protected;
- package-private;
- private;
- module export/open rules;
- nestmate access;
- permitted subclass constraints.

Error bisa muncul jika compile-time dan runtime tidak konsisten.

---

## 8. Initialization

### 8.1 Class initialization method `<clinit>`

Static initializer dan static field initializer dikompilasi menjadi class initialization method:

```text
<clinit>
```

Contoh:

```java
class Settings {
    static final String ENV = System.getenv("APP_ENV");
    static {
        System.out.println("Settings initialized");
    }
}
```

Compiler menghasilkan `<clinit>` yang melakukan assignment dan print.

### 8.2 Constructor vs class initializer

| Source concept | Bytecode/runtime |
|---|---|
| Constructor | instance initialization method `<init>` |
| Static initializer | class initialization method `<clinit>` |

`<init>` berjalan setiap object dibuat.

`<clinit>` berjalan sekali per class per classloader.

### 8.3 Kapan class diinisialisasi?

Class initialization dapat dipicu oleh active use, misalnya:

- membuat instance dengan `new`;
- membaca static field non-constant;
- menulis static field;
- memanggil static method;
- reflection tertentu;
- initialization subclass yang membutuhkan superclass initialized;
- default method tertentu pada interface.

Contoh:

```java
class A {
    static {
        System.out.println("A init");
    }

    static final int CONST = 42;
    static final Integer BOXED = 42;
}

public class Demo {
    public static void main(String[] args) {
        System.out.println(A.CONST);
    }
}
```

Membaca compile-time constant seperti `static final int CONST = 42` bisa tidak memicu initialization `A`, karena constant di-inline ke caller.

Tetapi:

```java
System.out.println(A.BOXED);
```

akan memicu initialization.

### 8.4 Initialization order

Untuk class:

```text
1. superclass initialized first
2. static fields/static blocks execute in textual order
3. class considered initialized
```

Untuk object:

```text
1. allocate object with default values
2. superclass constructor chain
3. instance fields/instance blocks in textual order
4. constructor body
```

### 8.5 Static initialization failure

Jika `<clinit>` melempar exception:

```text
ExceptionInInitializerError
```

Setelah itu class bisa berada dalam failed initialization state.

Akses berikutnya dapat menghasilkan:

```text
NoClassDefFoundError: Could not initialize class ...
```

### 8.6 Static initializer anti-pattern

Hindari:

```java
class BadConfig {
    static final Connection DB = DriverManager.getConnection(...);
}
```

Masalah:

- I/O saat class loading;
- sulit ditest;
- gagal sekali bisa merusak class state;
- order initialization sulit diprediksi;
- startup lambat;
- hidden dependency;
- tidak ada retry policy;
- sulit observability.

Lebih baik:

```java
final class DatabaseConnectionFactory {
    Connection open(Config config) {
        // explicit resource creation
    }
}
```

### 8.7 Class initialization deadlock

Static initializer synchronized secara internal oleh JVM.

Jika dua class saling menunggu initialization, bisa deadlock.

Contoh konseptual:

```java
class A {
    static final int X = B.Y;
}

class B {
    static final int Y = A.X;
}
```

Versi kompleks bisa melibatkan threads.

Guideline:

- jangan start thread dari static initializer;
- jangan block on external resource dalam static initializer;
- jangan melakukan dependency injection manual di static initializer;
- jangan melakukan network call di static initializer;
- jangan membuat circular static dependency.

---

## 9. Method Invocation dan Dynamic Dispatch

### 9.1 Overloading compile-time, overriding runtime

Overloading dipilih compile-time:

```java
void handle(Object o) {}
void handle(String s) {}

Object x = "hello";
handle(x); // handle(Object)
```

Overriding dipilih runtime:

```java
Animal a = new Dog();
a.sound(); // Dog.sound()
```

Bytecode untuk method call menyimpan symbolic target berdasarkan compile-time type/signature, tetapi runtime method selection bisa memilih override.

### 9.2 Virtual dispatch

Untuk `invokevirtual`, JVM melakukan dispatch berdasarkan runtime class receiver.

Konseptual:

```text
receiver actual class -> method table -> target implementation
```

Implementation detail bisa memakai vtable/inline cache, tetapi specification mendefinisikan behavior, bukan struktur internal.

### 9.3 Interface dispatch

Untuk `invokeinterface`, receiver harus implement interface.

Interface dispatch historis lebih mahal daripada class virtual dispatch, tetapi HotSpot modern sangat mengoptimalkan common cases.

Jangan membuat desain buruk hanya untuk menghindari interface dispatch.

Tetapi pahami bahwa megamorphic callsite dapat sulit di-inline.

### 9.4 Monomorphic, bimorphic, megamorphic

JIT profiling mengamati receiver type di callsite.

| Callsite shape | Makna | Optimization potential |
|---|---|---|
| Monomorphic | satu receiver type dominan | sangat mudah inline |
| Bimorphic | dua receiver type | masih bisa optimized |
| Megamorphic | banyak receiver type | lebih sulit inline |

Contoh megamorphic:

```java
for (Handler h : handlers) {
    h.handle(event);
}
```

Jika `handlers` berisi banyak implementasi berbeda, callsite bisa menjadi megamorphic.

Apakah ini buruk? Tidak selalu. Tetapi untuk hot loop super intensif, ini penting.

### 9.5 Bridge method

Generics erasure dapat menghasilkan bridge method.

Contoh:

```java
interface Box<T> {
    T get();
}

final class StringBox implements Box<String> {
    public String get() {
        return "x";
    }
}
```

Karena erasure, interface method menjadi:

```text
Object get()
```

Class punya:

```text
String get()
```

Compiler bisa membuat bridge:

```java
public Object get() {
    return get(); // calls String get()
}
```

Ini menjaga polymorphism runtime.

### 9.6 Private method

Private method tidak virtual dalam arti normal overriding.

Subclass bisa punya method dengan nama sama, tetapi itu bukan override.

### 9.7 Final method/class dan JIT

`final` dapat membantu reasoning dan kadang optimization, tetapi HotSpot juga bisa melakukan speculative devirtualization tanpa final berdasarkan profiling/class hierarchy.

Jangan menggunakan `final` semata-mata demi micro-optimization.

Gunakan `final` untuk:

- invariant design;
- immutability;
- API stability;
- preventing accidental inheritance;
- domain clarity.

---

## 10. `invokedynamic`

### 10.1 Apa itu `invokedynamic`?

`invokedynamic` adalah bytecode instruction yang linkage-nya ditentukan oleh bootstrap method.

Sebelum Java 7, method invocation bytecode mostly fixed:

- static;
- virtual;
- interface;
- special.

`invokedynamic` menambahkan mekanisme:

```text
callsite
  ↓ bootstrap method
linked target
  ↓ invoked on subsequent calls
```

### 10.2 Lambda memakai `invokedynamic`

Java:

```java
Function<String, Integer> length = s -> s.length();
```

Tidak dikompilasi menjadi anonymous class biasa.

Compiler biasanya menghasilkan `invokedynamic` dengan bootstrap ke `LambdaMetafactory`.

Keuntungan:

- lebih fleksibel;
- JVM dapat menghasilkan implementation class/runtime form;
- better optimization opportunities;
- tidak perlu class file anonymous eksplisit untuk setiap lambda.

### 10.3 Method reference juga

```java
String::length
System.out::println
User::new
```

Semua bisa memakai mekanisme lambda metafactory.

### 10.4 String concatenation modern

Java:

```java
String s = "Hello " + name + " age " + age;
```

Modern Java dapat memakai `invokedynamic` untuk string concat, bukan selalu manual `StringBuilder` di bytecode.

Ini memungkinkan JVM memilih strategy.

Guideline:

- jangan rewrite semua concat menjadi `StringBuilder` secara manual;
- dalam loop intensif, tetap pahami allocation;
- ukur dengan JMH/JFR sebelum mengoptimasi.

### 10.5 Why it matters

`invokedynamic` menjelaskan kenapa bytecode modern kadang terlihat “tidak langsung”.

Saat debugging/instrumentation:

- call target bisa muncul setelah bootstrap;
- tool lama bisa salah memahami class file;
- bytecode transformation harus preserve bootstrap methods;
- coverage/profiling harus aware dynamic callsites.

---

## 11. Execution Engine: Interpreter sampai JIT

### 11.1 Interpreter

Saat method pertama kali dijalankan, JVM biasanya menginterpret bytecode.

Interpreter:

- cepat start;
- tidak perlu compile dulu;
- mengumpulkan profiling information;
- cocok untuk cold code.

### 11.2 Kenapa tidak langsung compile semua?

Karena tidak semua code worth optimizing.

Aplikasi besar punya banyak method yang:

- hanya dipanggil sekali saat startup;
- error handling path jarang;
- admin endpoint jarang;
- migration code jarang;
- fallback path jarang.

Compile semua method upfront akan:

- memperlambat startup;
- memakai CPU;
- memakai memory/code cache;
- mengoptimalkan code yang mungkin tidak pernah dipakai.

HotSpot memilih hot methods berdasarkan profiling.

### 11.3 HotSpot

Nama HotSpot berasal dari ide menemukan “hot spots” dalam program.

JVM mengumpulkan profil:

- method invocation count;
- loop backedge count;
- branch behavior;
- receiver types;
- null/type check behavior;
- exception frequency;
- array bounds behavior;
- method data.

Saat threshold tercapai, method bisa masuk compile queue.

### 11.4 Tiered compilation

HotSpot modern memakai tiered compilation.

Konseptual:

```text
Interpreter
  ↓ collect profile
C1 compiler
  ↓ faster compiled code + profiling
C2 compiler
  ↓ aggressive optimized code
```

C1 fokus compile cepat.

C2 fokus optimasi agresif.

Catatan: detail tier bisa berubah antar versi/flag, tetapi mental modelnya:

```text
start fast, profile, optimize hot code progressively
```

### 11.5 Warmup

Warmup adalah periode saat aplikasi belum mencapai steady-state performance.

Selama warmup:

- class masih diload;
- methods masih interpreted;
- profiling sedang dikumpulkan;
- JIT compile terjadi;
- code cache bertambah;
- GC behavior belum stabil;
- framework lazily initializes components.

Benchmark tanpa warmup sering salah.

### 11.6 Compilation queue

Jika banyak method hot sekaligus, compiler thread punya queue.

Masalah:

- aplikasi CPU-bound saat startup;
- compile queue panjang;
- request awal lambat;
- container CPU limit memperburuk warmup.

Diagnostic:

```bash
jcmd <pid> Compiler.queue
jcmd <pid> Compiler.codecache
```

Unified logging:

```bash
java -Xlog:jit+compilation=debug -jar app.jar
```

atau legacy diagnostic flags:

```bash
java -XX:+PrintCompilation -jar app.jar
```

### 11.7 Code cache

Compiled native code disimpan di code cache.

Jika code cache penuh:

- JIT compile bisa berhenti/terbatas;
- performance turun;
- warning muncul.

Diagnostic:

```bash
jcmd <pid> Compiler.codecache
```

Tuning jarang diperlukan untuk aplikasi biasa, tetapi penting untuk:

- app besar;
- banyak generated classes;
- dynamic proxy heavy;
- scripting/dynamic language on JVM;
- long-running service dengan banyak generated code.

### 11.8 OSR: On-Stack Replacement

Masalah:

```java
while (running) {
    process();
}
```

Kalau method masuk loop panjang, menunggu method selesai sebelum compile tidak masuk akal.

OSR memungkinkan JVM mengganti execution frame interpreter yang sedang berada di loop menjadi compiled code.

Mental model:

```text
interpreter executing loop
  ↓ loop hot
compile OSR version
  ↓ jump into compiled loop body
```

### 11.9 Safepoints

Safepoint adalah titik di mana thread Java berada dalam state yang diketahui JVM sehingga VM operation tertentu bisa dilakukan aman.

Contoh operation yang butuh coordination:

- GC;
- deoptimization;
- class unloading;
- biased/locking historical operations;
- stack walking;
- code cache maintenance;
- some JFR sampling modes.

Safepoint bukan “pause setiap instruksi”. JVM menyisipkan safepoint polling di tempat strategis.

Masalah production:

```text
Application latency spike
  not caused by slow business logic
  but by VM operation / safepoint pause / GC / deoptimization
```

Diagnostic:

```bash
java -Xlog:safepoint=info -jar app.jar
```

---

## 12. JIT Optimization Mental Model

### 12.1 JIT optimizes based on observed reality

JIT bukan compiler statis biasa.

Ia bisa membuat asumsi berdasarkan runtime:

- “callsite ini selalu menerima `ArrayList`”;
- “branch ini hampir selalu true”;
- “object ini tidak escape method”;
- “class hierarchy saat ini hanya punya satu implementation loaded”;
- “null check ini redundant”;
- “array bounds check ini redundant dalam loop”.

Jika asumsi berubah, JVM bisa deoptimize.

### 12.2 Inlining

Inlining mengganti method call dengan body method.

Contoh:

```java
int total(Order o) {
    return o.price() + o.tax();
}
```

Jika `price()` dan `tax()` kecil, JIT bisa inline.

Manfaat:

- hilangkan call overhead;
- buka peluang optimasi lanjutan;
- constant folding;
- dead code elimination;
- escape analysis lebih kuat.

Inlining adalah gateway optimization.

Tanpa inlining, banyak optimasi tidak terlihat.

### 12.3 Devirtualization

Virtual call bisa diubah menjadi direct call jika JVM yakin targetnya.

Contoh:

```java
List<String> list = new ArrayList<>();
list.size();
```

Compile-time type `List`, runtime profile mungkin selalu `ArrayList`.

JIT dapat devirtualize dan inline `ArrayList.size()`.

### 12.4 Class Hierarchy Analysis

Jika class/interface hierarchy menunjukkan hanya satu implementasi loaded, JVM bisa mengoptimasi.

Namun Java dinamis: class baru bisa diload nanti.

Jika class baru invalidates assumption, deoptimization dapat terjadi.

### 12.5 Escape analysis

Escape analysis menjawab:

> Apakah object ini keluar dari scope sehingga harus benar-benar dialokasikan di heap?

Contoh:

```java
record Point(int x, int y) {}

int sum(int a, int b) {
    Point p = new Point(a, b);
    return p.x() + p.y();
}
```

Jika `p` tidak escape, JIT bisa:

- eliminate allocation;
- scalar replace fields;
- menganggap `x` dan `y` sebagai scalar value.

Source tetap membuat object secara semantic, tetapi optimized code bisa tidak allocate.

### 12.6 Scalar replacement

Object diganti menjadi field-field scalar.

```text
Point object
  x
  y
```

Menjadi:

```text
int x
int y
```

Ini alasan microbenchmark allocation bisa misleading jika object tidak escape.

### 12.7 Lock elimination

Jika object lock tidak escape, synchronized bisa dieliminasi.

Contoh konseptual:

```java
StringBuffer sb = new StringBuffer();
sb.append("a");
sb.append("b");
return sb.toString();
```

Jika `sb` local dan tidak escape, lock internal bisa dieliminasi.

Jangan gunakan ini sebagai alasan memakai synchronized collection sembarangan. Ini optimization opportunistic, bukan contract.

### 12.8 Range check elimination

Java array access harus bounds-checked.

```java
for (int i = 0; i < arr.length; i++) {
    sum += arr[i];
}
```

JIT bisa membuktikan `i` selalu valid dan menghilangkan checks di loop body.

Tetapi bentuk loop aneh bisa menghambat.

### 12.9 Loop optimizations

JIT bisa melakukan:

- loop unrolling;
- loop peeling;
- invariant code motion;
- range check elimination;
- vectorization in limited cases;
- counted loop optimization.

### 12.10 Constant folding

```java
int x = 10 * 20;
```

Dapat menjadi:

```java
int x = 200;
```

Lebih menarik:

```java
static final boolean DEBUG = false;

if (DEBUG) {
    expensiveLog();
}
```

Bisa dieliminasi jika compile-time constant.

### 12.11 Dead code elimination

Code yang hasilnya tidak observable bisa dihapus.

Ini penting untuk benchmarking:

```java
for (int i = 0; i < n; i++) {
    compute(i);
}
```

Jika hasil `compute` tidak digunakan dan tidak ada side effect, JIT bisa menghapus sebagian/semua.

Gunakan JMH `Blackhole` untuk benchmark.

### 12.12 Branch prediction and profiling

JVM bisa mengatur code layout berdasarkan branch frequency.

Misal:

```java
if (likelyValid(request)) {
    fastPath();
} else {
    slowRejectPath();
}
```

Jika profile menunjukkan valid 99%, JIT dapat mengoptimasi fast path.

Tetapi jika traffic berubah drastis, profile lama bisa kurang representatif.

### 12.13 Intrinsics

Beberapa method library dikenali khusus oleh JVM dan diganti dengan instruksi/implementasi optimized.

Contoh umum:

- `System.arraycopy`;
- beberapa `Math` operations;
- `String` operations;
- VarHandle/Unsafe primitives;
- crypto/vector-related implementation tertentu.

Jangan berasumsi semua method library biasa. Beberapa sangat special.

### 12.14 Barriers

JIT harus bekerja bersama GC dan memory model.

Compiled code dapat berisi:

- write barrier;
- read/load barrier;
- card marking;
- safepoint poll;
- memory fence.

Optimization tidak boleh melanggar:

- Java Memory Model;
- GC correctness;
- exception semantics;
- class initialization semantics;
- null check semantics;
- array bounds semantics.

---

## 13. Deoptimization

### 13.1 Optimized code berdasarkan asumsi

JIT membuat native code cepat berdasarkan assumptions.

Contoh:

```text
At callsite X, receiver type always Foo
```

JIT inline `Foo.method()`.

Lalu class baru `Bar extends Base` diload dan bisa menjadi receiver valid.

Assumption invalid.

### 13.2 Apa itu deoptimization?

Deoptimization adalah proses kembali dari optimized compiled code ke interpreter atau less optimized code.

JVM harus merekonstruksi state seolah-olah program selalu berjalan sesuai semantic Java.

Ini sulit karena optimized code mungkin:

- menghilangkan allocation;
- inline banyak method;
- reorder operation;
- eliminate checks;
- scalar replace object.

JVM menyimpan metadata agar bisa reconstruct.

### 13.3 Uncommon trap

Jika branch jarang terjadi, JIT bisa mengoptimasi seolah branch itu uncommon.

Jika branch tiba-tiba terjadi:

```text
trap -> deopt -> interpreter handles rare path
```

Ini efisien jika path benar-benar jarang.

Tetapi jika traffic berubah, banyak deopt bisa menjadi performance issue.

### 13.4 Performance cliff karena profile berubah

Contoh:

```java
interface Rule {
    Decision evaluate(Case c);
}
```

Saat startup training:

- hanya 1 implementation rule aktif;
- JIT inline aggressively.

Setelah feature flag berubah:

- 20 implementation aktif;
- callsite jadi megamorphic;
- deopt terjadi;
- performance turun.

Guideline:

- benchmark dengan workload representatif;
- jangan hanya benchmark satu implementation;
- perhatikan feature flags;
- profiling production penting.

### 13.5 Diagnostic deoptimization

Advanced flags bisa dipakai, tetapi banyak diagnostic flag memerlukan unlock:

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+LogCompilation ...
```

Namun untuk kebanyakan engineer, gunakan:

- JFR;
- async-profiler;
- `jcmd Compiler.*`;
- GC/safepoint logs;
- JMH untuk microbenchmark.

---

## 14. Class-File API Java 25

### 14.1 Kenapa Class-File API penting?

Sebelum standard Class-File API, banyak tooling memakai library seperti ASM, BCEL, Javassist, Byte Buddy.

Java 24 menghadirkan standard API `java.lang.classfile`; di Java 25 API ini sudah bagian dari platform.

Use cases:

- parsing class file;
- generating class file;
- transforming class file;
- static analysis;
- dependency extraction;
- bytecode instrumentation;
- educational tooling;
- custom compiler backend;
- framework/runtime tooling.

### 14.2 Mental model API

Class-File API memakai tiga abstraksi besar:

| Abstraksi | Makna |
|---|---|
| Element | immutable description bagian class file |
| Builder | membangun compound element |
| Transform | fungsi transformasi element ke builder |

Dengan Java modern:

- records;
- sealed types;
- pattern matching;
- lambdas;

class-file manipulation bisa lebih idiomatis daripada visitor-heavy style lama.

### 14.3 Parse class file

Pseudo-concept:

```java
Path path = Path.of("target/classes/com/example/App.class");
byte[] bytes = Files.readAllBytes(path);

ClassModel model = ClassFile.of().parse(bytes);

for (ClassElement element : model) {
    // inspect methods, fields, attributes
}
```

Untuk analisis dependency, kamu bisa mencari instruction seperti:

- field instruction;
- invoke instruction;
- type instruction;
- constant load.

### 14.4 Generate class file

Class-File API juga dapat membangun class file secara programmatic.

Use case:

- code generator;
- DSL compiler;
- framework generated adapter;
- test fixture bytecode;
- low-level experiment.

Namun production guideline:

- jangan generate bytecode jika source generation cukup;
- bytecode generation menaikkan debugging complexity;
- pastikan StackMapTable valid;
- pastikan compatibility dengan target JDK;
- test dengan verifier;
- gunakan JDK version matrix.

### 14.5 Transform class file

Transformasi berarti:

```text
old class elements
  ↓ inspect/filter/map
new class elements
```

Contoh use case:

- add method timing instrumentation;
- rewrite method body;
- inject annotation;
- remove debug info;
- collect dependency graph;
- enforce architecture rule.

Caution:

- instrumentation dapat mengubah performance;
- instrumentation dapat memicu verification error;
- instrumentation dapat bentrok dengan agent lain;
- instrumentation dapat mengganggu AOT cache consistency;
- instrumentation dapat mengubah stack trace;
- instrumentation dapat membuat debugging lebih sulit.

### 14.6 Kapan pakai Class-File API vs ASM/Byte Buddy?

| Need | Pilihan umum |
|---|---|
| Standard JDK API, parsing/generating modern class file | Class-File API |
| Ecosystem mature instrumentation | Byte Buddy / ASM |
| Java agent complex runtime instrumentation | Byte Buddy/ASM masih umum |
| Educational internal tool | Class-File API |
| Framework already built on ASM | jangan rewrite tanpa alasan kuat |

---

## 15. Agents, Instrumentation, dan Class Transformation

### 15.1 Java agent

Java agent dapat dipasang saat startup:

```bash
java -javaagent:agent.jar -jar app.jar
```

Agent bisa:

- inspect class saat loading;
- transform bytecode;
- record metrics/traces;
- instrument methods;
- enable profiling/security tooling.

APM tools sering memakai agent.

### 15.2 JVMTI

JVMTI adalah native interface untuk tool.

Use case:

- debugger;
- profiler;
- monitoring agent;
- heap inspection;
- thread inspection.

JVMTI sangat powerful, tetapi juga dapat mempengaruhi runtime behavior.

### 15.3 Transformation timing

Class transformation biasanya terjadi saat class loading.

Jika class sudah loaded, redefinisi/retransformation punya batasan.

Tidak semua perubahan allowed setelah class loaded.

### 15.4 Agent conflict

Production system bisa punya beberapa agent:

- OpenTelemetry agent;
- APM vendor;
- security scanner;
- coverage agent;
- custom diagnostics agent.

Risiko:

- urutan transformasi berbeda;
- stack map invalid;
- duplicate instrumentation;
- overhead besar;
- classloader issue;
- startup lebih lambat;
- AOT cache tidak usable;
- support vendor saling menyalahkan.

Guideline:

- catat semua agent di deployment manifest;
- benchmark dengan agent aktif;
- test startup dan warmup dengan agent aktif;
- jangan hanya test local tanpa agent;
- observability agent adalah bagian dari runtime, bukan aksesori.

---

## 16. AOT, CDS, dan Project Leyden Direction

### 16.1 JIT vs AOT: jangan disederhanakan berlebihan

Java historically kuat karena JIT:

```text
run program
  observe behavior
  optimize hot code
```

AOT mencoba memindahkan sebagian pekerjaan ke waktu lebih awal:

```text
training/build/deploy time
  prepare/cache some runtime work
production start
  use cache
```

Tetapi Java tetap dinamis.

JDK 25 AOT direction tidak sama dengan “compile semua Java ke native executable”.

### 16.2 CDS

Class Data Sharing menyimpan metadata class tertentu dalam archive agar bisa dipakai ulang.

Manfaat:

- startup lebih cepat;
- memory sharing antar JVM process;
- parsing/loading lebih sedikit.

CDS menjadi fondasi untuk AOT cache modern.

### 16.3 AOT Class Loading & Linking

JEP 483 memperkenalkan AOT cache untuk membuat classes aplikasi tersedia dalam state loaded dan linked saat HotSpot JVM start.

Workflow JDK 24 dua langkah:

```bash
java -XX:AOTMode=record \
     -XX:AOTConfiguration=app.aotconf \
     -cp app.jar com.example.App

java -XX:AOTMode=create \
     -XX:AOTConfiguration=app.aotconf \
     -XX:AOTCache=app.aot \
     -cp app.jar

java -XX:AOTCache=app.aot \
     -cp app.jar com.example.App
```

Mental model:

```text
training run records what startup does
cache creation stores loaded/linked class forms
production run reuses cache
```

### 16.4 JDK 25 AOT Command-Line Ergonomics

JDK 25 menyederhanakan common workflow dengan:

```bash
java -XX:AOTCacheOutput=app.aot \
     -cp app.jar com.example.App
```

Lalu production:

```bash
java -XX:AOTCache=app.aot \
     -cp app.jar com.example.App
```

Caution:

- training run harus representatif;
- classpath/module options harus konsisten;
- cache bisa diabaikan jika tidak compatible;
- one-step workflow bisa butuh memory lebih besar karena sub-invocation;
- user-defined classloaders punya batasan;
- agent tertentu dapat mengganggu consistency;
- jangan anggap AOT cache menggantikan warmup testing.

### 16.5 AOT Method Profiling

JDK 25 juga membawa AOT Method Profiling.

Ide:

```text
training run collects method execution profiles
AOT cache carries profiles
production start gives JIT profile immediately
JIT can compile useful methods earlier
```

Ini menargetkan warmup, bukan hanya startup.

### 16.6 Startup vs warmup vs peak performance

Bedakan:

| Istilah | Makna |
|---|---|
| Startup time | waktu sampai app siap menerima work |
| Warmup time | waktu sampai performance stabil/optimal |
| Peak performance | throughput/latency setelah optimasi matang |
| First request latency | latency request awal setelah app dianggap ready |
| Steady-state latency | latency saat runtime stabil |

AOT cache membantu startup/warmup tertentu, tetapi tidak otomatis memperbaiki:

- DB connection slow;
- DNS slow;
- migrations slow;
- Spring bean heavy initialization;
- remote config fetch;
- cold Kafka metadata;
- lazy TLS handshake;
- bad algorithm;
- GC pressure.

### 16.7 AOT cache decision framework

Gunakan jika:

- startup matters;
- service autoscale sering;
- CLI tool harus cepat;
- serverless-ish workload;
- batch job pendek;
- startup framework heavy;
- classpath/module stable;
- training workload bisa dibuat representatif.

Hati-hati jika:

- plugin architecture heavy;
- user-defined classloaders banyak;
- runtime classpath dinamis;
- banyak bytecode agents;
- deployment environment tidak konsisten;
- startup bukan bottleneck utama;
- cache artifact management belum matang.

---

## 17. JVM Internal dan Framework Java

### 17.1 Spring

Spring startup banyak memakai:

- classpath scanning;
- annotation metadata reading;
- reflection;
- proxy generation;
- bean definition creation;
- condition evaluation;
- configuration class parsing;
- CGLIB/JDK proxy;
- generated lambda/metafactory patterns;
- class loading on demand.

JVM perspective:

```text
Spring startup = class loading + metadata inspection + reflection + proxy/class generation + object graph construction
```

Jika startup lambat, jangan langsung menyalahkan “Java lambat”.

Investigasi:

- class count loaded;
- bean count;
- reflection/config scanning;
- auto-configuration;
- AOT/native hints;
- lazy initialization;
- CDS/AOT cache;
- JFR startup recording.

### 17.2 Hibernate/JPA

Hibernate dapat melibatkan:

- entity class scanning;
- annotation reading;
- proxy/enhancement;
- bytecode enhancement;
- reflection;
- method handle;
- generated SQL metadata;
- classloader interaction.

Failure umum:

- classloader leak di app server/devtools;
- lazy proxy class issue;
- bytecode enhancement conflict;
- `NoSuchMethodError` akibat dependency mismatch;
- entity instrumentation incompatible dengan JDK baru.

### 17.3 Mockito/testing

Mocking framework bisa memakai:

- subclass generation;
- inline mocking agent;
- bytecode transformation;
- method interception;
- class redefinition.

Jika test gagal hanya di JDK tertentu, periksa:

- Byte Buddy version;
- Mockito version;
- preview feature;
- sealed/final/record support;
- module opens;
- agent compatibility.

### 17.4 Jackson

Jackson banyak memakai:

- reflection;
- annotation inspection;
- constructor/record component metadata;
- method handles;
- generated accessor in some modules.

Untuk records/sealed types, metadata class file penting.

---

## 18. JVM Internal Failure Models

### 18.1 `UnsupportedClassVersionError`

Cause:

```text
compile target newer than runtime
```

Example:

```text
class file version 69.0
runtime supports up to 65.0
```

Fix:

- align runtime JDK;
- set `--release`;
- use toolchains;
- check container base image;
- check CI vs production JDK.

### 18.2 `NoSuchMethodError`

Cause:

```text
binary dependency mismatch
```

Compile saw method; runtime class does not have it.

Fix:

- inspect dependency tree;
- check duplicate JAR;
- check classpath order;
- check shaded artifact;
- check BOM;
- use `mvn dependency:tree` or Gradle dependencies;
- use `jdeps` where helpful.

### 18.3 `ClassCastException` same class name

Cause:

```text
same binary name loaded by different classloaders
```

Fix:

- inspect classloader hierarchy;
- avoid sharing model classes via separate plugin loaders;
- define API classes in parent loader;
- isolate implementation only;
- avoid duplicate jars.

### 18.4 `VerifyError`

Cause:

- invalid bytecode;
- bad instrumentation;
- stale bytecode tool;
- incompatible class file version;
- corrupted class file;
- stack map mismatch.

Fix:

- disable agents one by one;
- upgrade bytecode libraries;
- inspect with `javap -v`;
- verify target bytecode;
- reproduce without instrumentation.

### 18.5 `OutOfMemoryError: Metaspace`

Possible causes:

- too many classes loaded;
- generated class leak;
- classloader leak;
- redeploy loop in app server;
- devtools restart loader leak;
- dynamic proxy explosion;
- script engine generating classes.

Diagnostics:

```bash
jcmd <pid> VM.classloader_stats
jcmd <pid> GC.class_histogram
jcmd <pid> VM.native_memory summary
```

### 18.6 Code cache full

Symptoms:

- warning about code cache;
- JIT disabled/limited;
- performance degrades;
- long-running app with many generated methods/classes.

Diagnostics:

```bash
jcmd <pid> Compiler.codecache
```

### 18.7 Slow warmup

Causes:

- CPU quota too low;
- too many classes;
- too many beans;
- JIT compiler queue;
- large codebase;
- APM agent overhead;
- reflection scanning;
- lazy path loaded on first request;
- under-representative training run.

Diagnostics:

- JFR startup recording;
- `-Xlog:class+load`;
- `jcmd Compiler.queue`;
- CPU profile;
- compare with/without agents.

---

## 19. Practical Lab: Melihat JVM Bekerja

### 19.1 Lab 1 — Disassemble simple method

File:

```java
public class Calc {
    static int add(int a, int b) {
        return a + b;
    }
}
```

Run:

```bash
javac Calc.java
javap -c -v Calc
```

Perhatikan:

- major version;
- constant pool;
- method descriptor;
- `Code`;
- `LineNumberTable`.

### 19.2 Lab 2 — Overload vs override

```java
class Animal {}
class Dog extends Animal {}

class Demo {
    static void f(Animal a) {
        System.out.println("animal");
    }

    static void f(Dog d) {
        System.out.println("dog");
    }

    public static void main(String[] args) {
        Animal x = new Dog();
        f(x);
    }
}
```

Prediksi output.

Lihat bytecode call target.

### 19.3 Lab 3 — Dynamic dispatch

```java
interface Handler {
    void handle();
}

class A implements Handler {
    public void handle() { System.out.println("A"); }
}

class B implements Handler {
    public void handle() { System.out.println("B"); }
}

public class DispatchDemo {
    public static void main(String[] args) {
        Handler h = args.length == 0 ? new A() : new B();
        h.handle();
    }
}
```

Run:

```bash
javac DispatchDemo.java
javap -c DispatchDemo
```

Cari:

```text
invokeinterface
```

### 19.4 Lab 4 — Lambda bytecode

```java
import java.util.function.Function;

public class LambdaDemo {
    public static void main(String[] args) {
        Function<String, Integer> f = s -> s.length();
        System.out.println(f.apply("abc"));
    }
}
```

Run:

```bash
javac LambdaDemo.java
javap -c -v LambdaDemo
```

Cari:

- `invokedynamic`;
- `BootstrapMethods`;
- `LambdaMetafactory`.

### 19.5 Lab 5 — String concat

```java
public class ConcatDemo {
    static String message(String name, int age) {
        return "Name=" + name + ", age=" + age;
    }
}
```

Disassemble dan cari apakah memakai `invokedynamic`.

### 19.6 Lab 6 — Class initialization

```java
class InitTarget {
    static final int CONST = 42;
    static final Integer BOXED = 42;

    static {
        System.out.println("InitTarget initialized");
    }
}

public class InitDemo {
    public static void main(String[] args) {
        System.out.println(InitTarget.CONST);
        System.out.println("---");
        System.out.println(InitTarget.BOXED);
    }
}
```

Prediksi output.

Lalu run.

### 19.7 Lab 7 — Class loading log

```bash
java -Xlog:class+load=info InitDemo
```

Lihat kapan class diload.

### 19.8 Lab 8 — JIT compilation log

```java
public class HotLoop {
    static long sum(int n) {
        long s = 0;
        for (int i = 0; i < n; i++) {
            s += i;
        }
        return s;
    }

    public static void main(String[] args) {
        long x = 0;
        for (int i = 0; i < 100_000; i++) {
            x += sum(1000);
        }
        System.out.println(x);
    }
}
```

Run:

```bash
javac HotLoop.java
java -XX:+PrintCompilation HotLoop
```

Perhatikan method yang dikompilasi.

### 19.9 Lab 9 — AOT cache experiment

Untuk aplikasi sederhana:

```bash
java -XX:AOTCacheOutput=app.aot -cp app.jar com.example.App
java -XX:AOTCache=app.aot -cp app.jar com.example.App
```

Bandingkan startup time.

Catatan:

- jangan simpulkan dari satu run;
- gunakan beberapa run;
- pisahkan cold filesystem cache vs warm filesystem cache;
- cek warning jika cache tidak dipakai.

---

## 20. How to Think Like a JVM-Aware Engineer

### 20.1 Jangan optimasi sebelum punya model

Urutan berpikir:

```text
1. Apa gejalanya?
2. Startup, warmup, peak, atau tail latency?
3. Apakah bottleneck CPU, allocation, lock, I/O, class loading, GC, JIT?
4. Apa evidence-nya?
5. Tool apa yang membuktikan?
6. Apakah perubahan source masuk akal?
7. Apakah runtime flags/config lebih tepat?
8. Bagaimana regression test/perf test-nya?
```

### 20.2 Source code tidak cukup

Untuk performance issue, lihat:

- JFR;
- flame graph;
- allocation profile;
- GC log;
- safepoint log;
- class loading log;
- compiler queue;
- code cache;
- thread dump;
- dependency graph.

### 20.3 Jangan terlalu percaya microbenchmark manual

Manual benchmark sering salah karena:

- tidak ada warmup;
- dead code elimination;
- constant folding;
- escape analysis;
- unrealistic input;
- no fork isolation;
- measuring startup instead of steady state;
- GC effects ignored;
- CPU frequency scaling;
- OS noise;
- JIT profile pollution.

Gunakan JMH.

### 20.4 Design affects JVM

Desain source mempengaruhi optimizability:

- immutable small objects often optimize well;
- huge polymorphic hierarchies can make callsites megamorphic;
- reflection hides target from compiler/JIT;
- allocation-heavy pipelines pressure GC;
- synchronized hot path causes contention;
- dynamic class generation affects metaspace/code cache;
- static initialization can harm startup;
- dependency graph affects class loading.

### 20.5 JVM optimization is not a contract

Jangan menulis correctness yang bergantung pada:

- inlining;
- escape analysis;
- lock elimination;
- finalization timing;
- GC timing;
- deoptimization behavior;
- class loading order beyond spec;
- JIT threshold;
- object layout.

Optimization can change.

Correctness must rely on Java specification and documented APIs.

---

## 21. JVM Internal Checklist untuk Code Review

### 21.1 Startup/class loading

- Apakah ada static initializer melakukan I/O?
- Apakah classpath terlalu besar?
- Apakah reflection scanning bisa dibatasi?
- Apakah dependency duplicate?
- Apakah agent overhead dipahami?
- Apakah lazy initialization menunda masalah ke first request?

### 21.2 Binary compatibility

- Apakah library upgrade berpotensi `NoSuchMethodError`?
- Apakah BOM konsisten?
- Apakah semua module dikompilasi dengan target JDK sama?
- Apakah public API berubah secara binary incompatible?
- Apakah multi-release JAR dipahami?

### 21.3 Bytecode/instrumentation

- Apakah tool bytecode mendukung JDK 25 class file?
- Apakah StackMapTable valid?
- Apakah instrumentation ditest dengan production agents?
- Apakah module `opens` dibutuhkan?
- Apakah sealed/record/hidden class support aman?

### 21.4 Performance/JIT

- Apakah hot path punya allocation tidak perlu?
- Apakah callsite sangat megamorphic?
- Apakah reflection dipakai di hot path?
- Apakah benchmark sudah memakai JMH?
- Apakah warmup dipisahkan dari steady-state?
- Apakah code path representative?

### 21.5 Observability

- Apakah JFR bisa dinyalakan?
- Apakah class loading/JIT/GC logs bisa dikumpulkan saat incident?
- Apakah container menyimpan JVM flags?
- Apakah build artifact mencatat JDK version?
- Apakah deployment mencatat agents?

---

## 22. Mini Project — JVM Lens

Bangun CLI kecil bernama `jvm-lens`.

### 22.1 Goal

Input:

```bash
java -jar jvm-lens.jar target/classes/com/example/App.class
```

Output:

```text
Class: com.example.App
Version: 69
Methods:
  main([Ljava/lang/String;)V
  handle(Lcom/example/Event;)V

Constant pool references:
  java/lang/System.out
  java/io/PrintStream.println
  com/example/Service.process

Features detected:
  - invokedynamic: lambda/string concat
  - Record attribute: no
  - PermittedSubclasses: no
  - RuntimeVisibleAnnotations: yes

Risk hints:
  - uses reflection
  - contains synchronized method
  - static initializer present
```

### 22.2 Implementation options

Option A — shell wrapper:

- call `javap -v`;
- parse text;
- easier but brittle.

Option B — Class-File API:

- parse binary class file;
- inspect model;
- more robust;
- good learning exercise.

### 22.3 Features

Minimum:

- read class name;
- list methods;
- list fields;
- detect major version;
- detect `Code` attributes;
- count bytecode instructions;
- detect invocation opcodes.

Advanced:

- dependency graph;
- detect static initializer;
- detect large method;
- detect `synchronized`;
- detect `invokedynamic`;
- detect annotations;
- detect record/sealed metadata;
- export JSON.

### 22.4 Why this project matters

Kamu akan memahami:

- class file structure;
- descriptors;
- bytecode instructions;
- metadata attributes;
- generated code patterns;
- dependency surface;
- difference between source-level and bytecode-level design.

---

## 23. Ringkasan Mental Model

### 23.1 Pipeline

```text
Java source
  ↓ javac
Class file
  ↓ class loader
Loaded class
  ↓ verifier
Verified class
  ↓ preparation
Static storage defaulted
  ↓ resolution
Symbolic references linked
  ↓ initialization
Static initializers executed
  ↓ interpreter
Bytecode executed + profiled
  ↓ JIT
Hot code compiled to native code
  ↓ assumptions invalid?
Deopt back to interpreter
```

### 23.2 Prinsip utama

1. Java source bukan execution unit JVM; class file adalah contract utama.
2. Bytecode adalah stack-machine instruction set.
3. Class loading bersifat dynamic dan lazy.
4. Class identity melibatkan classloader.
5. Linking error bisa muncul saat runtime path tertentu, bukan hanya startup.
6. Static initialization adalah hidden execution; treat carefully.
7. JIT optimization berdasarkan profile, bukan janji compile-time.
8. Deoptimization adalah fitur normal, bukan bug.
9. Framework Java banyak bergantung pada class metadata, reflection, proxy, dan instrumentation.
10. AOT cache Java 25 membantu startup/warmup, tetapi tidak menggantikan desain aplikasi yang baik.
11. Untuk performance, source code saja tidak cukup; gunakan JFR/profiler/logs.
12. Correctness harus berbasis specification, bukan optimization behavior.

---

## 24. Latihan Pemahaman

### 24.1 Level 1

Jawab tanpa melihat referensi:

1. Apa beda `.java`, `.class`, bytecode, dan native code?
2. Apa isi constant pool?
3. Kenapa JVM memakai operand stack?
4. Apa beda `invokestatic`, `invokevirtual`, `invokeinterface`, `invokespecial`, `invokedynamic`?
5. Apa beda loading, linking, initialization?

### 24.2 Level 2

Praktik:

1. Buat class dengan lambda, disassemble, cari `invokedynamic`.
2. Buat class dengan overloaded dan overridden method, bandingkan bytecode call.
3. Buat class dengan `static final int` dan `static final Integer`, amati initialization.
4. Buat generic class, cari `Signature` dan bridge method.
5. Jalankan `-Xlog:class+load=info` untuk aplikasi kecil.

### 24.3 Level 3

Analisis:

1. Kenapa `NoSuchMethodError` bisa muncul padahal compile berhasil?
2. Kenapa class dengan nama sama bisa gagal cast ke dirinya sendiri?
3. Kenapa benchmark manual bisa terlalu cepat karena object allocation dieliminasi?
4. Kenapa startup cepat belum tentu warmup cepat?
5. Kenapa agent observability bisa mengubah behavior runtime?

### 24.4 Level 4

Production scenario:

Kamu punya service Spring Boot Java 25.

Gejala:

- pod ready dalam 35 detik;
- request pertama p95 3 detik;
- setelah 5 menit p95 turun ke 80 ms;
- CPU tinggi 2 menit pertama;
- tidak ada GC besar.

Susun investigasi:

- class loading log;
- JFR startup recording;
- compiler queue;
- code cache;
- Spring startup metrics;
- agent overhead;
- AOT cache experiment;
- representative warmup endpoint;
- readiness gating.

---

## 25. Referensi Resmi

- Java Virtual Machine Specification SE 25  
  https://docs.oracle.com/javase/specs/jvms/se25/html/index.html

- Java Language Specification SE 25  
  https://docs.oracle.com/javase/specs/jls/se25/html/index.html

- Java SE 25 & JDK 25 API  
  https://docs.oracle.com/en/java/javase/25/docs/api/index.html

- JDK 25 Tool Specifications  
  https://docs.oracle.com/en/java/javase/25/docs/specs/man/index.html

- `java` command — JDK 25  
  https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html

- `javac` command — JDK 25  
  https://docs.oracle.com/en/java/javase/25/docs/specs/man/javac.html

- `javap` command — JDK 25  
  https://docs.oracle.com/en/java/javase/25/docs/specs/man/javap.html

- Class-File API — `java.lang.classfile`  
  https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/classfile/package-summary.html

- JEP 484 — Class-File API  
  https://openjdk.org/jeps/484

- JEPs integrated in JDK 25 since JDK 21  
  https://openjdk.org/projects/jdk/25/jeps-since-jdk-21

- JEP 483 — Ahead-of-Time Class Loading & Linking  
  https://openjdk.org/jeps/483

- JEP 514 — Ahead-of-Time Command-Line Ergonomics  
  https://openjdk.org/jeps/514

- JEP 515 — Ahead-of-Time Method Profiling  
  https://openjdk.org/jeps/515

- Significant Changes in JDK 25 Release  
  https://docs.oracle.com/en/java/javase/25/migrate/significant-changes-jdk-25.html

---

## 26. Apa yang Harus Kamu Kuasai Sebelum Lanjut

Sebelum masuk Bagian 13 tentang memory management dan garbage collection, pastikan kamu bisa menjelaskan:

- kenapa object ada di heap tetapi reference bisa ada di local variable slot;
- apa itu frame;
- apa hubungan method area/metaspace dengan class loading;
- bagaimana JIT dan GC saling berkaitan lewat safepoint/barrier;
- kenapa allocation rate penting;
- kenapa class metadata leak berbeda dari heap object leak;
- kenapa object layout adalah implementation detail tetapi penting untuk performance.

Kalau bagian ini sudah masuk, Bagian 13 tentang heap, object layout, allocation, TLAB, humongous object, GC, G1, ZGC, dan Shenandoah akan jauh lebih mudah dipahami.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 11 — Text, Unicode, Locale, Date-Time](./learn-java-part-011.md) | [🏠 Daftar Isi](../index.md) | [Selanjutnya ➡️: Learn Java Part 013 — Memory Management dan Garbage Collection](./learn-java-part-013.md)
