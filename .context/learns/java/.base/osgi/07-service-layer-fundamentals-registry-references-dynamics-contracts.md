# Part 7 — Service Layer Fundamentals: Registry, References, Dynamics, and Contracts

> Series: `learn-java-osgi-dynamic-module-runtime-engineering`  
> File: `07-service-layer-fundamentals-registry-references-dynamics-contracts.md`  
> Scope: Java 8 sampai Java 25  
> Level: Advanced / platform engineering

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membahas bagaimana OSGi menyusun sistem dari sisi:

1. bundle sebagai unit deployment,
2. manifest sebagai kontrak metadata,
3. classloader per bundle,
4. package import/export,
5. resolver dan wiring,
6. semantic versioning API.

Itu semua menjawab pertanyaan:

> “Bagaimana kode dari bundle A bisa melihat tipe dari bundle B secara benar, konsisten, dan versioned?”

Part ini mulai masuk ke pertanyaan yang lebih hidup:

> “Setelah tipe terlihat, bagaimana runtime object saling menemukan, saling memakai, berubah, hilang, muncul lagi, diganti, dan tetap aman?”

Di OSGi, jawaban utamanya adalah **Service Layer**.

Service Layer adalah salah satu alasan utama OSGi berbeda dari sekadar module system. JPMS dapat memberi dependency graph statis. Maven dapat memberi artifact graph build-time. Spring dapat memberi dependency injection container. Tetapi OSGi Service Layer memberi **dynamic in-process service registry** yang terintegrasi dengan lifecycle bundle.

Artinya:

- provider service bisa muncul setelah consumer sudah aktif,
- provider service bisa hilang saat consumer masih hidup,
- provider bisa diganti tanpa mematikan framework,
- beberapa provider bisa tersedia bersamaan,
- consumer bisa memilih provider berdasarkan metadata,
- runtime bisa berubah tanpa restart JVM penuh.

Ini powerful, tetapi berbahaya jika engineer masih berpikir dengan asumsi classpath monolith:

```text
start application -> semua bean tersedia -> dependency tetap -> stop application
```

OSGi lebih dekat ke:

```text
runtime hidup lama -> bundle datang/pergi -> service datang/pergi -> graph berubah -> consumer harus adaptif
```

---

## 1. Mental Model Utama: Service Registry Bukan Dependency Injection Container Biasa

### 1.1 Service Registry sebagai Pasar Dinamis

Bayangkan service registry seperti pasar internal dalam satu JVM.

Provider berkata:

```text
Saya menyediakan service dengan interface X,
metadata Y,
ranking Z,
dan object implementation ini.
```

Consumer berkata:

```text
Saya butuh service dengan interface X,
dengan property tertentu,
dan saya siap bereaksi kalau service itu muncul, berubah, atau hilang.
```

Registry tidak “memiliki” semua object seperti traditional container. Registry lebih seperti **broker visibility dan lifecycle**.

OSGi Core mendefinisikan Service Layer sebagai dynamic collaborative model yang terintegrasi dengan Life Cycle Layer. Modelnya adalah **publish, find, and bind**. Service adalah object Java biasa yang didaftarkan di registry di bawah satu atau lebih interface; bundle dapat mendaftarkan, mencari, atau menerima notifikasi saat registration state berubah.

### 1.2 Perbedaan dengan Spring Bean Container

Spring container pada umumnya:

```text
ApplicationContext start
  -> scan/configure beans
  -> resolve dependencies
  -> instantiate graph
  -> application ready
```

OSGi service registry:

```text
Framework start
  -> bundles installed/resolved/started independently
  -> services registered/unregistered dynamically
  -> consumers track and adapt
```

Perbedaan penting:

| Aspek | Spring Bean Container | OSGi Service Registry |
|---|---|---|
| Dependency availability | biasanya fixed setelah context ready | dynamic sepanjang runtime |
| Object ownership | container owns beans | bundle/provider owns service object |
| Dependency lookup | mostly injection/config time | runtime lookup/tracking |
| Failure model | missing bean biasanya startup failure | missing service bisa terjadi kapan saja |
| Replacement | jarang runtime replacement | native part of model |
| Visibility | classpath/context-based | bundle classloader + package wiring + service registry |
| Metadata selection | bean name/qualifier/profile | service properties + LDAP filter + ranking |
| Lifecycle coupling | context lifecycle | bundle/service/component lifecycle |

Ini bukan berarti Spring salah. Ini berarti mental modelnya berbeda. Di OSGi, dependency tidak boleh dianggap permanen kecuali kita sengaja membuat policy yang memaksa demikian.

---

## 2. Apa Itu OSGi Service?

### 2.1 Service Adalah Object Java Biasa

Service OSGi bukan remote service secara default, bukan REST endpoint, bukan message queue, bukan microservice.

Service adalah object Java biasa:

```java
public interface PostalCodeNormalizer {
    String normalize(String rawPostalCode);
}
```

Implementation:

```java
public final class SingaporePostalCodeNormalizer implements PostalCodeNormalizer {
    @Override
    public String normalize(String rawPostalCode) {
        if (rawPostalCode == null) {
            throw new IllegalArgumentException("postal code must not be null");
        }
        String digits = rawPostalCode.replaceAll("\\D", "");
        if (digits.length() != 6) {
            throw new IllegalArgumentException("Singapore postal code must contain 6 digits");
        }
        return digits;
    }
}
```

Service menjadi OSGi service saat didaftarkan ke registry:

```java
Dictionary<String, Object> properties = new Hashtable<>();
properties.put("country", "SG");
properties.put("format", "six-digit");

ServiceRegistration<PostalCodeNormalizer> registration =
    bundleContext.registerService(
        PostalCodeNormalizer.class,
        new SingaporePostalCodeNormalizer(),
        properties
    );
```

Yang penting:

```text
Object biasa + interface contract + registry registration + properties = OSGi service
```

### 2.2 Service Harus Didaftarkan dengan Interface Stabil

Secara teknis service bisa didaftarkan dengan class concrete. Secara desain, ini buruk.

Buruk:

```java
bundleContext.registerService(
    SingaporePostalCodeNormalizer.class,
    new SingaporePostalCodeNormalizer(),
    properties
);
```

Lebih baik:

```java
bundleContext.registerService(
    PostalCodeNormalizer.class,
    new SingaporePostalCodeNormalizer(),
    properties
);
```

Kenapa?

Karena service registry adalah boundary antarbundle. Boundary harus berupa kontrak stabil, bukan implementation detail.

Jika consumer tahu implementation class provider, maka:

- provider tidak bisa diganti transparan,
- implementation package harus diekspor,
- classloader coupling meningkat,
- semantic versioning menjadi kacau,
- plugin model melemah,
- testing/mocking lebih sulit.

Rule praktis:

```text
Export API package.
Keep implementation package private.
Register service under API interface.
```

---

## 3. Service Registry sebagai Runtime Index

Registry menyimpan mapping seperti ini:

```text
service.id=101
objectClass=[com.acme.address.api.PostalCodeNormalizer]
service.bundleid=12
service.scope=singleton
service.ranking=0
country=SG
format=six-digit
```

Setiap service registration punya:

- service object atau factory,
- daftar interface/class name tempat service dipublikasikan,
- properties,
- unique service id,
- owning bundle,
- service scope,
- lifecycle state.

Registry bukan sekadar map dari interface ke object. Registry adalah searchable metadata index.

Consumer bisa mencari:

```text
Semua PostalCodeNormalizer
```

atau:

```text
PostalCodeNormalizer dengan country=SG
```

atau:

```text
AddressValidationRule dengan region=SG dan severity=blocking
```

atau:

```text
ReportRenderer dengan format=pdf dan tenant=cea
```

---

## 4. Registering Service Secara Manual

Walau modern OSGi biasanya memakai Declarative Services, manual registration penting untuk memahami primitive-nya.

### 4.1 BundleActivator Provider

```java
package com.acme.address.internal;

import com.acme.address.api.PostalCodeNormalizer;
import org.osgi.framework.BundleActivator;
import org.osgi.framework.BundleContext;
import org.osgi.framework.ServiceRegistration;

import java.util.Dictionary;
import java.util.Hashtable;

public final class AddressActivator implements BundleActivator {

    private ServiceRegistration<PostalCodeNormalizer> registration;

    @Override
    public void start(BundleContext context) {
        Dictionary<String, Object> props = new Hashtable<>();
        props.put("country", "SG");
        props.put("format", "six-digit");

        PostalCodeNormalizer service = new SingaporePostalCodeNormalizer();

        this.registration = context.registerService(
            PostalCodeNormalizer.class,
            service,
            props
        );
    }

    @Override
    public void stop(BundleContext context) {
        if (registration != null) {
            registration.unregister();
            registration = null;
        }
    }
}
```

Manifest:

```properties
Bundle-Activator: com.acme.address.internal.AddressActivator
Export-Package: com.acme.address.api;version="1.0.0"
Private-Package: com.acme.address.internal
```

### 4.2 Runtime Meaning

Saat bundle start:

```text
provider bundle ACTIVE
  -> registers PostalCodeNormalizer service
  -> registry emits REGISTERED event
  -> interested consumers can bind
```

Saat bundle stop:

```text
provider bundle STOPPING
  -> unregisters PostalCodeNormalizer service
  -> registry emits UNREGISTERING event
  -> consumers must unbind/recover
```

### 4.3 Registration Object Tidak Boleh Dilupakan

`ServiceRegistration` adalah handle untuk registration tersebut.

Jika provider tidak unregister:

- registry bisa menahan reference,
- service object bisa leak,
- classloader bundle bisa leak setelah update/uninstall,
- consumer bisa memanggil service dari bundle yang seharusnya sudah mati.

OSGi framework memang akan membersihkan service yang didaftarkan oleh bundle saat bundle stop, tetapi explicit unregister tetap bagian dari lifecycle hygiene terutama saat provider membuat registration dinamis.

---

## 5. Consuming Service Secara Manual

### 5.1 Lookup Sederhana

```java
ServiceReference<PostalCodeNormalizer> reference =
    context.getServiceReference(PostalCodeNormalizer.class);

if (reference != null) {
    PostalCodeNormalizer service = context.getService(reference);
    try {
        String normalized = service.normalize("048 621");
    } finally {
        context.ungetService(reference);
    }
}
```

Ini terlihat sederhana, tetapi ada banyak konsekuensi.

### 5.2 `ServiceReference` Bukan Service Object

`ServiceReference<T>` adalah metadata handle ke service registration.

Ia bisa digunakan untuk:

- mendapatkan properties,
- membandingkan ranking/order,
- mengambil service object lewat `BundleContext.getService(reference)`,
- melepaskan usage lewat `ungetService(reference)`.

Service object baru diperoleh saat `getService` dipanggil.

### 5.3 Kenapa Harus `ungetService`?

OSGi menghitung usage count per bundle terhadap service reference.

Jika consumer selalu `getService` tetapi tidak `ungetService`:

- usage count bocor,
- service factory lifecycle bisa salah,
- prototype service object bisa tidak dilepas,
- provider update/unregister bisa tertahan secara konseptual,
- memory leak lebih sulit dilacak.

Pattern aman:

```java
ServiceReference<MyService> ref = context.getServiceReference(MyService.class);
if (ref == null) {
    return;
}

MyService svc = context.getService(ref);
try {
    if (svc != null) {
        svc.execute();
    }
} finally {
    context.ungetService(ref);
}
```

### 5.4 Lookup Sederhana Tidak Cukup untuk Runtime Dinamis

Lookup one-shot buruk untuk dependency jangka panjang:

```java
public final class BadConsumer {
    private final PaymentGateway gateway;

    public BadConsumer(BundleContext context) {
        ServiceReference<PaymentGateway> ref =
            context.getServiceReference(PaymentGateway.class);
        this.gateway = context.getService(ref);
    }

    public void pay(PaymentRequest request) {
        gateway.pay(request);
    }
}
```

Masalah:

- service bisa hilang setelah constructor,
- reference tidak di-unget,
- provider bisa diganti tetapi consumer tetap memakai object lama,
- tidak ada fallback,
- tidak ada state transition saat service unavailable.

Ini pola classpath, bukan pola dynamic runtime.

---

## 6. Service Events

Registry mengeluarkan event saat service berubah.

Tipe event umum:

- `REGISTERED`
- `MODIFIED`
- `MODIFIED_ENDMATCH`
- `UNREGISTERING`

### 6.1 Listener Manual

```java
context.addServiceListener(event -> {
    ServiceReference<?> ref = event.getServiceReference();

    switch (event.getType()) {
        case ServiceEvent.REGISTERED -> {
            // service appeared
        }
        case ServiceEvent.MODIFIED -> {
            // service properties changed
        }
        case ServiceEvent.UNREGISTERING -> {
            // service is going away
        }
    }
}, "(objectClass=com.acme.address.api.PostalCodeNormalizer)");
```

### 6.2 Event Ordering dan Race Condition

Service events tidak menghapus kebutuhan untuk lookup ulang secara aman.

Race umum:

```text
1. Consumer menerima REGISTERED event.
2. Sebelum consumer getService, provider unregister.
3. getService mengembalikan null.
```

Maka kode harus defensif:

```java
Object service = context.getService(reference);
if (service == null) {
    // service already gone
    return;
}
```

Dynamic runtime berarti event adalah notifikasi, bukan jaminan keabadian.

---

## 7. ServiceTracker: Primitive untuk Tracking Dinamis

Manual listener + lookup + unget cepat menjadi rawan. OSGi menyediakan `ServiceTracker`.

### 7.1 Basic ServiceTracker

```java
ServiceTracker<PostalCodeNormalizer, PostalCodeNormalizer> tracker =
    new ServiceTracker<>(context, PostalCodeNormalizer.class, null);

tracker.open();

PostalCodeNormalizer normalizer = tracker.getService();
if (normalizer != null) {
    normalizer.normalize("048621");
}
```

Saat stop:

```java
tracker.close();
```

### 7.2 Customizer

```java
ServiceTracker<PaymentGateway, PaymentGateway> tracker =
    new ServiceTracker<>(context, PaymentGateway.class, new ServiceTrackerCustomizer<>() {
        @Override
        public PaymentGateway addingService(ServiceReference<PaymentGateway> reference) {
            PaymentGateway gateway = context.getService(reference);
            if (gateway != null) {
                System.out.println("Payment gateway appeared: " + reference.getProperty("provider"));
            }
            return gateway;
        }

        @Override
        public void modifiedService(ServiceReference<PaymentGateway> reference, PaymentGateway service) {
            System.out.println("Payment gateway modified: " + reference.getProperty("provider"));
        }

        @Override
        public void removedService(ServiceReference<PaymentGateway> reference, PaymentGateway service) {
            try {
                System.out.println("Payment gateway removed: " + reference.getProperty("provider"));
            } finally {
                context.ungetService(reference);
            }
        }
    });

tracker.open();
```

### 7.3 ServiceTracker Masih Low-Level

ServiceTracker bagus untuk memahami mekanisme, tetapi untuk aplikasi modern:

```text
Declarative Services > manual ServiceTracker > manual ServiceListener
```

Namun top-tier engineer tetap perlu memahami ServiceTracker karena:

- DS dibangun di atas konsep serupa,
- debugging DS sering butuh memahami reference dynamics,
- custom extender sering memakai tracker,
- advanced dynamic registry pattern butuh tracker/customizer.

---

## 8. Service Properties: Metadata sebagai Selection Contract

Service properties membuat registry menjadi lebih dari sekadar map interface.

Contoh provider:

```java
Dictionary<String, Object> props = new Hashtable<>();
props.put("country", "SG");
props.put("channel", "postal");
props.put("priority", 100);
props.put(Constants.SERVICE_RANKING, 50);

context.registerService(AddressResolver.class, new OneMapAddressResolver(), props);
```

Consumer bisa mencari dengan filter:

```java
String filter = "(&(objectClass=com.acme.address.api.AddressResolver)(country=SG)(channel=postal))";
ServiceReference<?>[] refs = context.getServiceReferences((String) null, filter);
```

### 8.1 Property Design Harus Stabil

Service property sering menjadi kontrak seleksi. Maka property harus diperlakukan seperti API.

Buruk:

```text
provider=impl1
mode=fast
flag=true
```

Lebih baik:

```text
country=SG
capability=address-resolution
source=onemap
supports.batch=true
```

Gunakan property yang merepresentasikan **capability**, bukan detail implementation.

### 8.2 Property Namespace

Untuk menghindari tabrakan:

```text
com.acme.address.country=SG
com.acme.address.source=onemap
com.acme.address.supports.batch=true
```

Namun property terlalu panjang juga tidak nyaman. Untuk platform internal besar, buat konstanta:

```java
public final class AddressServiceProperties {
    public static final String COUNTRY = "com.acme.address.country";
    public static final String SOURCE = "com.acme.address.source";
    public static final String SUPPORTS_BATCH = "com.acme.address.supports.batch";

    private AddressServiceProperties() {}
}
```

---

## 9. LDAP Filter Syntax

OSGi memakai LDAP-style filter untuk memilih service.

### 9.1 Equality

```text
(country=SG)
```

### 9.2 AND

```text
(&(country=SG)(channel=postal))
```

### 9.3 OR

```text
(|(country=SG)(country=MY))
```

### 9.4 NOT

```text
(!(deprecated=true))
```

### 9.5 Presence

```text
(country=*)
```

### 9.6 Approx / Comparison

Be careful with comparison filters. Use them only if property types are consistent.

```text
(priority>=100)
```

### 9.7 Practical Filter Examples

Select blocking compliance validators:

```text
(&(objectClass=com.acme.case.api.ValidationRule)(domain=compliance)(severity=blocking))
```

Select PDF renderer for tenant CEA:

```text
(&(objectClass=com.acme.document.api.DocumentRenderer)(format=pdf)(tenant=cea))
```

Select active connector excluding deprecated implementation:

```text
(&(objectClass=com.acme.connector.api.ExternalConnector)(system=onemap)(!(deprecated=true)))
```

### 9.8 Filter Pitfall: Business Logic Hidden in Strings

Jangan biarkan filter string tersebar di seluruh codebase.

Buruk:

```java
context.getServiceReferences(Validator.class, "(&(module=case)(severity=blocking))");
```

Lebih baik:

```java
public final class ValidatorFilters {
    public static String blockingCaseValidators() {
        return "(&(module=case)(severity=blocking))";
    }
}
```

Lebih baik lagi untuk DS:

```java
@Reference(target = "(&(module=case)(severity=blocking))")
private volatile List<ValidationRule> rules;
```

Tetap dokumentasikan property contract-nya.

---

## 10. Service Ranking dan Provider Selection

Jika ada banyak service untuk interface yang sama, OSGi punya ordering.

Property standar:

```java
Constants.SERVICE_RANKING
```

Semakin tinggi ranking, semakin diprioritaskan. Jika ranking sama, service id biasanya menentukan urutan; service id lebih rendah berarti service lebih lama.

Contoh:

```java
props.put(Constants.SERVICE_RANKING, 100);
```

### 10.1 Ranking Cocok untuk Default Override

Misalnya ada default renderer:

```text
DefaultPdfRenderer ranking=0
TenantSpecificPdfRenderer ranking=100
```

Consumer yang meminta `DocumentRenderer` terbaik akan mendapat tenant-specific jika cocok.

### 10.2 Ranking Tidak Boleh Menggantikan Explicit Selection

Buruk:

```text
service ranking menentukan business priority approval rule
```

Kenapa buruk?

Karena ranking adalah registry selection mechanism, bukan domain rule engine.

Jika urutan rule adalah domain contract, buat property explicit:

```text
rule.order=10
rule.phase=pre-submission
rule.severity=blocking
```

Lalu consumer sorting sendiri secara jelas.

### 10.3 Ranking Bisa Menyebabkan Pergantian Runtime

Jika service baru dengan ranking lebih tinggi muncul, consumer yang tracking “best service” bisa berpindah provider.

Pertanyaan desain:

```text
Apakah operation yang sedang berjalan boleh berpindah provider di tengah jalan?
```

Biasanya jawabannya tidak. Gunakan snapshot per operation.

```java
List<ValidationRule> snapshot = List.copyOf(currentRules);
for (ValidationRule rule : snapshot) {
    rule.validate(context);
}
```

---

## 11. Service Scope

OSGi mengenal beberapa scope service.

### 11.1 Singleton Scope

Satu service object dipakai semua consuming bundle.

```text
provider registers object A
consumer bundle 1 gets A
consumer bundle 2 gets A
```

Cocok untuk:

- stateless service,
- thread-safe singleton,
- shared connector client,
- immutable strategy.

Risiko:

- mutable shared state,
- thread-safety bug,
- lifecycle leak.

### 11.2 Bundle Scope via ServiceFactory

Provider bisa memberikan object berbeda per consuming bundle.

```java
public final class PerBundleGatewayFactory implements ServiceFactory<PaymentGateway> {
    @Override
    public PaymentGateway getService(Bundle bundle, ServiceRegistration<PaymentGateway> registration) {
        return new PaymentGatewayForBundle(bundle.getSymbolicName());
    }

    @Override
    public void ungetService(Bundle bundle,
                             ServiceRegistration<PaymentGateway> registration,
                             PaymentGateway service) {
        service.close();
    }
}
```

Registration:

```java
context.registerService(PaymentGateway.class, new PerBundleGatewayFactory(), props);
```

Cocok untuk:

- per-bundle isolation,
- consumer-specific context,
- resource ownership per consumer,
- backward compatibility adapter per bundle.

### 11.3 Prototype Scope via PrototypeServiceFactory

Prototype memberikan instance berbeda per `getServiceObjects().getService()` call.

Cocok untuk:

- stateful short-lived object,
- per-operation object,
- not thread-safe object yang perlu isolation,
- object mahal tapi harus explicit release.

Namun prototype menambah lifecycle complexity. Jangan gunakan jika stateless singleton cukup.

### 11.4 Scope Decision Matrix

| Kebutuhan | Scope yang masuk akal |
|---|---|
| Stateless, thread-safe | Singleton |
| Per consuming bundle state | Bundle scope / ServiceFactory |
| Per operation state | Prototype |
| Per request web object | Biasanya jangan registry langsung; gunakan web/request layer |
| Heavy pooled resource | Singleton wrapper dengan internal pool |
| Plugin-specific adapter | Bundle scope atau explicit plugin context |

---

## 12. Dynamic Availability: Service Bisa Hilang Kapan Saja

Ini prinsip paling penting.

Di OSGi, service dependency bukan fakta abadi. Service bisa hilang karena:

- provider bundle stopped,
- provider bundle updated,
- provider unregistered service,
- provider configuration invalid,
- DS component deactivated,
- framework refresh,
- permission/security filtering,
- service property changed dan tidak match filter lagi.

Consumer harus memilih policy:

```text
1. fail fast saat dependency tidak ada,
2. degrade gracefully,
3. wait/block dengan timeout,
4. queue work,
5. use fallback provider,
6. disable capability,
7. expose health status degraded.
```

### 12.1 Bad Pattern: Assume Always Available

```java
paymentGateway.pay(request);
```

Tanpa guard, tanpa lifecycle, tanpa fallback.

### 12.2 Better: Service Availability Explicit

```java
public PaymentResult pay(PaymentRequest request) {
    PaymentGateway gateway = currentGateway.get();
    if (gateway == null) {
        return PaymentResult.temporarilyUnavailable("payment gateway unavailable");
    }
    return gateway.pay(request);
}
```

### 12.3 Best: Operation Semantics Didefinisikan

Untuk tiap service dependency, jawab:

```text
Kalau service hilang sebelum operation dimulai, apa yang terjadi?
Kalau hilang saat operation berjalan, apa yang terjadi?
Kalau service diganti provider lain, apakah operation boleh pindah?
Kalau service property berubah, apakah consumer harus re-evaluate?
Apakah consumer harus expose degraded health?
```

---

## 13. Service Contract Design

OSGi service interface adalah API runtime. Desainnya harus lebih disiplin daripada interface internal biasa.

### 13.1 Contract Harus Menjelaskan Thread-Safety

Contoh Javadoc bagus:

```java
/**
 * Resolves a normalized postal code into an address candidate list.
 *
 * Thread-safety: implementations registered as OSGi services must be safe for
 * concurrent invocation by multiple bundles unless their service property
 * {@code com.acme.scope=prototype-only} states otherwise.
 */
public interface AddressResolver {
    AddressResolutionResult resolve(AddressResolutionRequest request);
}
```

Jika tidak jelas, consumer bisa salah memakai singleton provider secara concurrent.

### 13.2 Contract Harus Menjelaskan Blocking Behavior

```java
/**
 * May perform network I/O and must complete within the timeout specified in the request.
 */
AddressResolutionResult resolve(AddressResolutionRequest request);
```

Tanpa ini, service dipanggil dari DS activation atau event handler dan menyebabkan startup hang.

### 13.3 Contract Harus Menjelaskan Exception Model

Buruk:

```java
Address resolve(String postalCode) throws Exception;
```

Lebih baik:

```java
AddressResolutionResult resolve(AddressResolutionRequest request);
```

Dengan result type:

```java
public final class AddressResolutionResult {
    private final boolean successful;
    private final List<AddressCandidate> candidates;
    private final FailureReason failureReason;
    private final String diagnosticCode;
}
```

Atau checked exception yang stabil:

```java
Address resolve(String postalCode) throws AddressResolutionException;
```

### 13.4 Contract Harus Menghindari Implementation Types

Buruk:

```java
HibernateSession getSession();
ObjectMapper getInternalMapper();
DataSource unwrapInternalDataSource();
```

Ini bocorkan provider internal.

Lebih baik:

```java
CaseRepository repository();
JsonCodec codec();
TransactionRunner transactionRunner();
```

### 13.5 DTO Boundary Harus Stabil

DTO yang melewati service boundary harus berada di API package yang diekspor.

```text
com.acme.case.api
  CaseQuery
  CaseSummary
  CaseService
```

Jangan pakai DTO dari implementation package:

```text
com.acme.case.internal.jpa.CaseEntity
```

Jika consumer menerima entity implementation, maka:

- persistence model bocor,
- classloader coupling meningkat,
- lazy proxy issue muncul,
- versioning sulit,
- provider tidak bisa diganti.

---

## 14. Service Registry Bukan RPC

Walau disebut service, OSGi service bukan microservice call.

OSGi service call adalah method call dalam JVM:

```text
same process
same heap
same thread unless implementation creates another thread
same transaction context if manually propagated
same failure blast radius
```

Konsekuensi:

- tidak ada network isolation,
- tidak ada serialization boundary otomatis,
- exception langsung propagate,
- long-running call menahan thread caller,
- deadlock bisa lintas bundle,
- memory object bisa bocor lintas module,
- transaction/resource context bisa ikut terbawa.

### 14.1 Jangan Mendesain OSGi Service seperti REST API

REST API cenderung:

```text
coarse-grained
serialized DTO
network latency aware
failure isolated
```

OSGi service bisa lebih fine-grained, tetapi tetap harus hati-hati.

Buruk:

```java
userService.getUser(id).getProfile().getAddress().getCountry()
```

Jika object graph mutable melintasi boundary, provider internal bisa bocor.

Lebih baik:

```java
UserProfileSummary summary = userProfileService.getSummary(userId);
```

### 14.2 Jangan Mendesain OSGi Service Terlalu Chatty Bila Provider Dinamis

Jika provider bisa hilang/diganti, chatty protocol memperbesar failure surface.

Buruk:

```java
session.start();
session.setA();
session.setB();
session.execute();
session.close();
```

Lebih baik:

```java
ExecutionResult result = executor.execute(command);
```

---

## 15. Circular Service Dependency

Circular dependency adalah sumber runtime deadlock dan unsatisfied component.

Contoh:

```text
CaseService requires NotificationService
NotificationService requires TemplateService
TemplateService requires CaseService
```

Dalam static DI, ini sudah buruk. Dalam OSGi dynamic runtime, lebih buruk karena activation order dan availability berubah.

### 15.1 Cara Memecah Circular Dependency

#### Option A — Extract Lower-Level Contract

```text
CaseService -> NotificationService
NotificationService -> CaseSummaryProvider
CaseService implements CaseSummaryProvider
```

`CaseSummaryProvider` lebih kecil dari `CaseService`.

#### Option B — Event-Based Decoupling

```text
CaseService publishes CaseSubmittedEvent
NotificationService handles event
```

Cocok jika asynchronous dan eventual behavior diterima.

#### Option C — Command/Handler Registry

```text
TemplateService tidak memanggil CaseService.
Ia menerima TemplateContext yang sudah lengkap.
```

#### Option D — Split Read Model

```text
NotificationService depends on CaseReadModel, not CaseCommandService.
```

### 15.2 Rule

```text
Service dependency should form mostly directed acyclic graph.
Cycles must be intentional, documented, and mediated.
```

---

## 16. Stale Reference Problem

Stale reference terjadi saat consumer menyimpan service object lebih lama dari validitas registration.

```java
private PaymentGateway gateway;

void bind(PaymentGateway gateway) {
    this.gateway = gateway;
}

void unbind(PaymentGateway gateway) {
    // forgot to clear
}
```

Jika provider unregister, field masih menunjuk object lama.

### 16.1 Safer Dynamic Reference Pattern

```java
private final AtomicReference<PaymentGateway> gatewayRef = new AtomicReference<>();

void bind(PaymentGateway gateway) {
    gatewayRef.set(gateway);
}

void unbind(PaymentGateway gateway) {
    gatewayRef.compareAndSet(gateway, null);
}

PaymentResult pay(PaymentRequest request) {
    PaymentGateway gateway = gatewayRef.get();
    if (gateway == null) {
        return PaymentResult.unavailable();
    }
    return gateway.pay(request);
}
```

`compareAndSet` penting karena dynamic replacement bisa terjadi:

```text
old gateway unbind event arrives after new gateway bind
```

Kita tidak ingin unbind old menghapus new.

### 16.2 Snapshot Pattern untuk Multiple Services

```java
private final CopyOnWriteArrayList<ValidationRule> rules = new CopyOnWriteArrayList<>();

void bindRule(ValidationRule rule) {
    rules.addIfAbsent(rule);
}

void unbindRule(ValidationRule rule) {
    rules.remove(rule);
}

ValidationResult validate(CaseDraft draft) {
    List<ValidationRule> snapshot = List.copyOf(rules);
    for (ValidationRule rule : snapshot) {
        ValidationResult result = rule.validate(draft);
        if (result.isBlocking()) {
            return result;
        }
    }
    return ValidationResult.ok();
}
```

Snapshot memastikan satu operation memakai daftar konsisten.

---

## 17. Service Properties Can Change

Provider dapat memodifikasi properties service melalui `ServiceRegistration.setProperties`.

```java
Dictionary<String, Object> updated = new Hashtable<>();
updated.put("country", "SG");
updated.put("status", "degraded");
registration.setProperties(updated);
```

Consumer yang filter-nya tidak lagi match bisa menerima event `MODIFIED_ENDMATCH`.

### 17.1 Property Change Bisa Sama Signifikannya dengan Unregister

Jika consumer butuh:

```text
(status=ready)
```

lalu provider mengubah:

```text
status=degraded
```

Maka dari sudut consumer, service tersebut “hilang”.

### 17.2 Jangan Gunakan Service Property untuk High-Frequency State

Buruk:

```text
current.queue.size=123
last.latency.ms=52
current.active.requests=8
```

Jika di-update terus, registry jadi event storm.

Service property cocok untuk metadata relatif stabil:

- capability,
- tenant,
- region,
- format,
- protocol,
- version,
- status kasar,
- ranking.

Untuk metric dinamis, gunakan observability/metrics service.

---

## 18. Service Lifecycle and Threading

Service registry tidak otomatis membuat service method thread-safe.

Jika service singleton didaftarkan, semua consumer bisa memanggil object yang sama.

### 18.1 Provider Responsibility

Provider harus memastikan:

- object safe setelah registered,
- object tidak diekspos sebelum initialized,
- unregister terjadi sebelum resource ditutup atau call baru ditolak,
- in-flight call ditangani dengan aman,
- shared state synchronized/immutable.

### 18.2 Consumer Responsibility

Consumer harus memastikan:

- tidak menyimpan stale reference sembarangan,
- menangani service unavailable,
- tidak memanggil service dari activation path yang bisa deadlock,
- tidak mengasumsikan provider tertentu,
- tidak melakukan long call tanpa timeout/cancellation policy.

### 18.3 In-Flight Call saat Unregister

Unregister mencegah lookup baru, tetapi tidak otomatis menghentikan method call yang sudah berjalan.

Provider perlu graceful shutdown jika resource sensitif.

```java
public final class ManagedConnector implements ExternalConnector {
    private final AtomicBoolean accepting = new AtomicBoolean(true);
    private final AtomicInteger inFlight = new AtomicInteger();

    public ConnectorResult call(ConnectorRequest request) {
        if (!accepting.get()) {
            return ConnectorResult.unavailable("connector stopping");
        }

        inFlight.incrementAndGet();
        try {
            return doCall(request);
        } finally {
            inFlight.decrementAndGet();
        }
    }

    public void stopAccepting() {
        accepting.set(false);
    }
}
```

Stop sequence:

```text
1. unregister service or mark unavailable,
2. reject new calls,
3. wait bounded time for in-flight calls,
4. close resources.
```

---

## 19. Manual Service API vs Declarative Services

Manual service registry API penting, tetapi code bisnis modern jarang perlu menggunakannya langsung.

Declarative Services akan dibahas Part 8, tetapi preview-nya:

```java
@Component(service = PostalCodeNormalizer.class)
public final class SingaporePostalCodeNormalizer implements PostalCodeNormalizer {
    @Override
    public String normalize(String rawPostalCode) {
        return ...;
    }
}
```

Consumer:

```java
@Component
public final class AddressApplicationService {

    private volatile PostalCodeNormalizer normalizer;

    @Reference
    void bindNormalizer(PostalCodeNormalizer normalizer) {
        this.normalizer = normalizer;
    }

    void unbindNormalizer(PostalCodeNormalizer normalizer) {
        if (this.normalizer == normalizer) {
            this.normalizer = null;
        }
    }
}
```

DS mengurus:

- registration,
- dependency tracking,
- activation/deactivation,
- cardinality,
- dynamic/static binding,
- service properties,
- component lifecycle.

Tetapi DS tidak menghapus kebutuhan untuk memahami dynamic service semantics.

---

## 20. Designing Service APIs for OSGi

### 20.1 API Bundle Layout

Recommended:

```text
com.acme.address.api
  AddressResolver
  AddressResolutionRequest
  AddressResolutionResult
  AddressCandidate
  AddressFailureReason

com.acme.address.spi
  AddressResolverProvider
  AddressResolverFactory

com.acme.address.internal.onemap
  OneMapAddressResolver
  OneMapClient
  OneMapConfiguration
```

Manifest:

```properties
Export-Package: \
  com.acme.address.api;version="1.0.0",\
  com.acme.address.spi;version="1.0.0"
Private-Package: \
  com.acme.address.internal.*
```

### 20.2 API vs SPI

API adalah untuk caller biasa.

SPI adalah untuk plugin/provider implementer.

Contoh API:

```java
public interface AddressResolver {
    AddressResolutionResult resolve(AddressResolutionRequest request);
}
```

Contoh SPI:

```java
public interface AddressResolverProvider {
    String providerId();
    boolean supports(AddressResolutionRequest request);
    AddressResolver create(AddressResolverContext context);
}
```

Jangan campur API dan SPI sembarangan. SPI biasanya lebih sulit dijaga kompatibilitasnya karena implementer eksternal harus menyesuaikan.

### 20.3 Service Method Granularity

Terlalu kecil:

```java
PostalCodeParser parser();
AddressCandidateStore store();
GeocoderClient client();
```

Terlalu besar:

```java
EverythingService doEverything(...);
```

Bagus:

```java
AddressResolutionResult resolve(AddressResolutionRequest request);
```

Heuristic:

```text
A service method should represent one meaningful operation with stable inputs/outputs.
```

### 20.4 Avoid Returning Live Mutable Collections

Buruk:

```java
List<ValidationRule> getRules();
```

Jika list internal dikembalikan, consumer bisa modify provider state.

Lebih baik:

```java
List<ValidationRuleDescriptor> listRules(); // immutable snapshot
```

atau:

```java
Stream<ValidationRuleDescriptor> streamRules();
```

Hati-hati dengan stream: resource lifecycle harus jelas.

---

## 21. Service Registry Patterns

### 21.1 Strategy Service Pattern

Banyak implementation untuk satu contract.

```java
public interface DocumentRenderer {
    RenderedDocument render(RenderRequest request);
}
```

Providers:

```text
PdfRenderer format=pdf
HtmlRenderer format=html
DocxRenderer format=docx
```

Consumer memilih berdasarkan property.

### 21.2 Whiteboard Pattern

Provider tidak dipanggil langsung sebagai dependency tunggal. Provider mendaftarkan dirinya, dan central manager menemukan semua provider.

Contoh:

```text
ValidationRule services registered by bundles
ValidationEngine tracks all matching ValidationRule
```

Cocok untuk:

- plugins,
- handlers,
- filters,
- validators,
- endpoint registration,
- command registration.

### 21.3 Adapter Service Pattern

Provider mendaftarkan adapter untuk tipe tertentu.

```text
ExternalAgencyConnector agency=rom
ExternalAgencyConnector agency=sla
ExternalAgencyConnector agency=iras
```

Consumer memilih berdasarkan agency.

### 21.4 Optional Capability Pattern

Service hanya tersedia jika bundle/config tertentu aktif.

Consumer harus degrade:

```text
PDF rendering unavailable because renderer bundle is not installed
```

### 21.5 Fallback Service Pattern

Ada default provider ranking rendah.

```text
DefaultAddressResolver ranking=0
OneMapAddressResolver ranking=100
```

Jika OneMap hilang, default bisa dipakai.

Namun pastikan fallback semantics benar. Fallback diam-diam bisa berbahaya di domain regulated.

---

## 22. Service Boundary in Regulated / Case Management Systems

Untuk sistem enforcement/case management, service registry bisa sangat cocok untuk domain extension.

Contoh service contract:

```java
public interface EscalationRule {
    EscalationDecision evaluate(EscalationContext context);
}
```

Properties:

```text
module=case
case.type=complaint
phase=triage
severity=blocking
rule.id=complaint-triage-high-risk-v1
```

Runtime:

```text
Case engine tracks EscalationRule services.
Rule bundles can be added/updated independently.
Each rule has versioned API and metadata.
Engine executes snapshot of rules per transition.
Audit trail records rule ids and versions used.
```

Critical design points:

- rule API package must be stable,
- rule version must be auditable,
- service property must include rule id/version,
- engine must snapshot rules per decision,
- rule removal must not corrupt in-flight case transition,
- old cases may need old rule behavior for defensibility,
- hot update must be governed, not ad hoc.

OSGi makes dynamic extension possible. Governance makes it safe.

---

## 23. Runtime Failure Modes

### 23.1 Service Missing

Symptom:

```text
Consumer active, but operation says service unavailable.
```

Possible causes:

- provider bundle not installed,
- provider bundle not active,
- provider component unsatisfied,
- provider did not export API package correctly,
- consumer imported different API package version,
- filter mismatch,
- service property typo,
- permission filtering,
- provider registered under implementation class, not interface.

### 23.2 ClassCastException When Getting Service

Usually means consumer and provider do not share same API class identity.

Possible causes:

- API package embedded separately,
- provider exports one API version, consumer uses private embedded API,
- split package,
- wrong import/export,
- boot delegation hack.

### 23.3 Service Appears Twice

Possible causes:

- two provider bundles active,
- old bundle update did not uninstall old version,
- duplicate registration in activator,
- DS component plus manual registration both active,
- framework cache stale in dev.

### 23.4 Service Never Disappears

Possible causes:

- provider did not unregister dynamic registration,
- consumer holds reference causing leak symptoms,
- framework did cleanup but external registry/cache still holds object,
- static singleton retains service object,
- ServiceTracker not closed.

### 23.5 Consumer Uses Wrong Provider

Possible causes:

- ranking unexpected,
- filter too broad,
- property type mismatch,
- missing target filter,
- multiple providers with same ranking,
- service id ordering surprise.

---

## 24. Debugging Service Registry

### 24.1 Questions to Ask

When a service problem happens, ask in order:

```text
1. Is the provider bundle installed?
2. Is it resolved?
3. Is it active?
4. Did it register the service?
5. Under which objectClass?
6. Which service properties?
7. Which service ranking?
8. Which service scope?
9. Does consumer import the same API package exporter?
10. Does consumer filter match?
11. Is DS component satisfied?
12. Is service dynamically removed/modified?
13. Are there stale references?
14. Are there duplicate providers?
```

### 24.2 What to Inspect

Inspect:

- bundle state,
- exported/imported packages,
- service list,
- service properties,
- component state,
- framework events,
- service events,
- logs during register/unregister,
- wiring graph.

### 24.3 Debug Output You Want in Production

For dynamic service platform, add diagnostics endpoint/command that shows:

```text
Service Interface: com.acme.case.api.EscalationRule
Providers:
  - service.id=101
    bundle=com.acme.case.rules.complaint.highrisk/1.2.0
    ranking=100
    properties:
      rule.id=complaint-highrisk
      rule.version=1.2.0
      phase=triage
      severity=blocking
    state=registered

Consumers:
  - com.acme.case.engine/2.4.0
    filter=(&(phase=triage)(severity=blocking))
    bound=true
```

Without this, production OSGi debugging becomes guesswork.

---

## 25. Java 8 sampai Java 25 Considerations

Service registry concept itself remains stable across Java versions, but libraries and runtime assumptions change.

### 25.1 Java 8

Common realities:

- many legacy OSGi systems still Java 8,
- javax packages still common,
- older Blueprint/Spring DM/Equinox/Felix versions,
- weaker encapsulation,
- more libraries using TCCL/SPI assumptions.

Service design implication:

```text
Keep API simple, avoid Java version-specific types if API must run on Java 8.
```

Do not expose Java 9+ types in API package if consumers run Java 8.

### 25.2 Java 11/17

Common migration issues:

- removed Java EE modules,
- stronger illegal access warnings,
- older bytecode tools break,
- javax/jakarta coexistence,
- old libraries expecting JDK internals.

Service design implication:

```text
Do not expose removed Java EE/JDK-internal types in core service API.
```

### 25.3 Java 21/25

Modern Java features affect implementation, not always API.

Virtual threads can be useful behind service implementations, but be careful exposing concurrency model as API.

Good:

```java
public interface ReportGenerator {
    ReportResult generate(ReportRequest request);
}
```

Implementation may use virtual threads internally.

Risky API:

```java
StructuredTaskScope<?> createScope();
```

This couples service API to Java version and preview/final feature availability.

### 25.4 Rule for Cross-Java Service API

```text
If service API must support Java 8–25, keep API types conservative.
Use newer Java features inside implementation bundles where runtime permits.
```

---

## 26. Service API Versioning

Service interface lives in exported package. Therefore Part 6 rules apply.

### 26.1 Adding Method to Interface

Adding abstract method to public service interface is binary incompatible for existing providers.

Bad minor change:

```java
public interface AddressResolver {
    AddressResolutionResult resolve(AddressResolutionRequest request);

    // added later
    AddressResolutionResult reverseResolve(Coordinates coordinates);
}
```

Existing provider class breaks.

Better options:

#### Option A — New Interface

```java
public interface ReverseAddressResolver {
    AddressResolutionResult reverseResolve(Coordinates coordinates);
}
```

Provider can implement both.

#### Option B — Default Method

```java
default AddressResolutionResult reverseResolve(Coordinates coordinates) {
    return AddressResolutionResult.unsupported();
}
```

Only safe if Java 8+ and semantics acceptable. But default methods still require careful behavioral compatibility.

#### Option C — Capability Property

```text
supports.reverse=true
```

Consumer checks property before using extended contract.

### 26.2 Service Contract Major Version

For breaking change:

```text
com.acme.address.api;version=2.0.0
```

Possible strategies:

- run v1 and v2 API packages side by side if package name differs,
- adapter service v1 -> v2,
- consumer migration window,
- provider dual registration.

Be cautious: same package name cannot have two versions easily consumed by same bundle without complex classloading boundary. Often major API changes deserve package rename or bridge bundle.

---

## 27. Service Registry and Transactions

OSGi service call is normal Java method call. Transaction propagation is not automatic unless your transaction framework defines it.

### 27.1 Hidden Transaction Coupling

```java
caseService.submitCase(request);
```

Inside:

```text
CaseService opens transaction
  -> calls ValidationRule service
  -> calls NotificationService
  -> calls AuditService
```

Questions:

- Are validation rules allowed to access DB?
- Are notification calls inside transaction?
- If provider disappears, should transaction rollback?
- If audit service unavailable, is submission blocked?

### 27.2 Better Contract

Separate pure validation from side-effect services:

```java
public interface ValidationRule {
    ValidationResult validate(ValidationContext context);
}
```

No DB mutation, no external call.

For side effects:

```java
public interface CaseSubmissionObserver {
    void afterCommitted(CaseSubmittedEvent event);
}
```

This avoids plugin services accidentally participating in core transaction.

---

## 28. Service Registry and Security

Service registry can be filtered by permissions/security policies in secured OSGi environments.

Even if security manager-style sandboxing is less central in modern Java, design should assume:

- not every bundle should see every service,
- management shell should not expose sensitive service operations casually,
- service properties may leak metadata,
- plugin providers may be trusted/untrusted differently.

### 28.1 Sensitive Service Design

Do not expose raw credential/service secret objects as registry services.

Buruk:

```java
public interface SecretProvider {
    String getDatabasePassword();
}
```

Lebih baik:

```java
public interface DatabaseAccess {
    <T> T withConnection(ConnectionCallback<T> callback);
}
```

Or use credential internally inside provider.

### 28.2 Service Property Leakage

Avoid properties like:

```text
password=...
token=...
privateKeyPath=...
```

Properties are meant for selection/metadata, not secret transport.

---

## 29. Production Design Checklist

Before exposing a new OSGi service contract, answer:

### 29.1 Contract

- What is the service interface?
- Which package exports it?
- What is the package version?
- Is this API, SPI, or internal?
- Are request/response DTOs stable?
- Are exceptions stable?
- Is thread-safety documented?
- Is blocking behavior documented?
- Is transaction behavior documented?

### 29.2 Registry Metadata

- What properties identify capability?
- Which properties are stable contract?
- Are property names namespaced/constants?
- Is ranking used? Why?
- Is filter selection deterministic?
- Can multiple providers exist?
- What happens if two providers match?

### 29.3 Dynamics

- Can service disappear while consumer is active?
- What is consumer fallback?
- Is stale reference avoided?
- Is snapshot needed for multi-service operation?
- What happens when properties change?
- Are in-flight calls handled during unregister?

### 29.4 Runtime

- How can ops list registered services?
- How can ops see provider bundle/version?
- How can ops see unsatisfied consumers?
- Are service events logged where necessary?
- Are metrics available?
- Does health distinguish ACTIVE bundle vs usable service?

### 29.5 Versioning

- What is compatible minor change?
- What requires major version?
- Is baseline checking enabled?
- Can old provider work with new consumer?
- Can old consumer work with new provider?

---

## 30. Mini Case Study: Dynamic Validation Rule Platform

### 30.1 Requirement

A case management platform needs validation rules that differ by:

- module,
- case type,
- workflow phase,
- agency,
- severity,
- version.

Rules should be deployable independently without redeploying the core engine.

### 30.2 API Bundle

```java
package com.acme.validation.api;

public interface ValidationRule {
    ValidationResult validate(ValidationContext context);
}
```

DTOs:

```java
public final class ValidationContext {
    private final String module;
    private final String caseType;
    private final String phase;
    private final Map<String, Object> attributes;
}
```

```java
public final class ValidationResult {
    private final boolean valid;
    private final String code;
    private final String message;
    private final Severity severity;
}
```

### 30.3 Rule Provider Bundle

Service properties:

```text
module=case
case.type=complaint
phase=submission
severity=blocking
rule.id=complaint-required-documents
rule.version=1.0.0
```

### 30.4 Engine Consumer

Engine tracks all `ValidationRule` services matching:

```text
(module=case)
```

For each transition, it takes snapshot:

```java
List<RuleRegistration> snapshot = registry.snapshotRules(
    module,
    caseType,
    phase
);
```

It records audit:

```text
caseId=123
transition=SUBMIT
rulesUsed=[
  complaint-required-documents:1.0.0,
  complaint-valid-applicant:2.1.0
]
```

### 30.5 Why Snapshot Matters

Without snapshot:

```text
rule A runs
bundle update happens
rule B from new version runs
case decision is based on mixed rule set
```

In regulated systems, this can be indefensible.

With snapshot:

```text
all rules for one decision come from consistent captured set
```

### 30.6 Hot Update Governance

Even if OSGi supports hot deploy, production should define:

- who can deploy rule bundle,
- what tests must pass,
- how rule version is approved,
- whether in-flight cases use old or new rules,
- how rollback works,
- how audit proves which rule ran.

OSGi gives mechanism. Governance gives defensibility.

---

## 31. Common Anti-Patterns

### 31.1 Static Service Locator

```java
public final class Services {
    public static PaymentGateway paymentGateway;
}
```

This destroys lifecycle and classloader hygiene.

### 31.2 Export Implementation Package

```properties
Export-Package: com.acme.payment.*
```

This usually exports internals accidentally.

### 31.3 Cache Service Forever

```java
private static PaymentGateway gateway;
```

Stale reference + classloader leak.

### 31.4 Use Ranking as Business Rule Priority

Ranking should select provider, not encode domain ordering unless explicitly designed.

### 31.5 Optional Dependency Without Behavior

```text
Service optional, but code assumes not null.
```

Optional means you must define behavior when absent.

### 31.6 Register Half-Initialized Service

```java
MyService service = new MyService();
context.registerService(MyService.class, service, props);
service.startBackgroundInitialization();
```

Consumer may call before ready.

Better:

```text
initialize fully -> register service -> accept calls
```

### 31.7 Throw Random Runtime Exceptions Across Boundary

Use stable exception/result contract.

### 31.8 Business Object Graph Leakage

Returning entities, sessions, mutable internals across bundle boundary.

---

## 32. Top 1% Mental Model

A strong OSGi engineer does not think:

```text
How do I inject this dependency?
```

They think:

```text
What runtime contract exists between provider and consumer?
Can provider appear late?
Can it disappear?
Can there be multiple providers?
How is provider selected?
What happens to in-flight operations?
How is compatibility versioned?
How is this observed in production?
How do we avoid stale references and classloader leaks?
How do we audit which dynamic participant affected a decision?
```

Service Layer is not just convenience. It is a runtime architecture mechanism.

If you use it casually, it creates chaos.

If you use it deliberately, it enables a modular platform that can evolve for years.

---

## 33. Summary

Key takeaways:

1. OSGi service adalah object Java biasa yang didaftarkan ke dynamic service registry.
2. Service registry memakai model publish, find, bind.
3. Service dapat muncul, hilang, berubah, atau diganti saat runtime hidup.
4. `ServiceReference` adalah handle metadata, bukan service object.
5. `getService` harus dipasangkan dengan `ungetService` pada manual usage.
6. Service properties adalah selection contract dan harus didesain seperti API.
7. LDAP filter memungkinkan consumer memilih provider berdasarkan metadata.
8. Service ranking menentukan provider preference, tetapi tidak boleh sembarangan dipakai sebagai business priority.
9. Service scope menentukan apakah object singleton, per-bundle, atau prototype.
10. Stale reference adalah salah satu bug paling penting dalam dynamic runtime.
11. Service API harus mendokumentasikan thread-safety, blocking, exception, transaction, DTO boundary, dan lifecycle expectation.
12. Service registry bukan RPC dan bukan microservice boundary.
13. Circular service dependency harus dihindari atau dimediasi.
14. Production OSGi butuh diagnostics untuk service graph, provider bundle, properties, dan consumer binding.
15. Dynamic service architecture sangat kuat untuk plugin/rule/extension platform, tetapi harus disertai versioning dan governance.

---

## 34. Latihan

### Latihan 1 — Service Contract Review

Ambil satu interface service dari sistemmu. Tulis ulang dokumentasinya agar menjelaskan:

- thread-safety,
- blocking behavior,
- exception model,
- transaction expectation,
- DTO ownership,
- apakah provider boleh multiple,
- apakah provider boleh hilang saat runtime.

### Latihan 2 — Registry Property Design

Desain service properties untuk:

```text
DocumentRenderer
```

yang mendukung:

- pdf,
- html,
- docx,
- tenant-specific implementation,
- default fallback,
- deprecated provider.

Pastikan property tidak membocorkan implementation detail.

### Latihan 3 — Dynamic Failure Scenario

Untuk service:

```text
ExternalAgencyConnector
```

jawab:

1. Apa yang terjadi jika connector hilang sebelum request?
2. Apa yang terjadi jika connector hilang saat request berjalan?
3. Apakah fallback diizinkan?
4. Apakah request boleh diqueue?
5. Apa yang harus muncul di health check?
6. Apa yang harus diaudit?

### Latihan 4 — Stale Reference Fix

Ubah kode consumer yang menyimpan service di field biasa menjadi:

- `AtomicReference` untuk single dynamic service,
- `CopyOnWriteArrayList` atau immutable snapshot untuk multiple services.

### Latihan 5 — Rule Platform Snapshot

Desain pseudo-code untuk validation engine yang:

- mengambil snapshot rule services,
- mengurutkan rule berdasarkan property domain,
- menjalankan rule,
- mencatat rule id/version ke audit,
- aman jika bundle rule di-update saat evaluation berjalan.

---

## 35. Koneksi ke Part Berikutnya

Part ini membahas primitive Service Layer secara manual.

Part berikutnya akan membahas **Declarative Services Deep Dive**:

- component lifecycle,
- `@Component`,
- `@Reference`,
- activation/deactivation,
- cardinality,
- static vs dynamic policy,
- greedy vs reluctant,
- configuration integration,
- component scope,
- service registration otomatis,
- dan cara menghindari lifecycle chaos dengan model deklaratif.

Jika Part 7 adalah “bagaimana registry bekerja”, Part 8 adalah “bagaimana menulis komponen production-grade tanpa manual lifecycle boilerplate”.

---

## Status Series

```text
Part 7 dari 35 selesai.
Series belum selesai.
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 6 — Semantic Versioning in OSGi: Package Versions, Bundle Versions, API Evolution](./06-semantic-versioning-package-versions-bundle-versions-api-evolution.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 8 — Declarative Services Deep Dive: Components, References, Activation, and Conditions](./08-declarative-services-components-references-activation-conditions.md)
