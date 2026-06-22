# learn-java-json-xml-soap-connectors-enterprise-integration — Part 032
# JCA Inbound/Outbound Architecture

> Series: Java (Jakarta/Javax) JSON, JSON Processing, JSON Binding, XML, XML Binding, XML Web Services, SOAP Legacy, and Connectors  
> Part: 032 / 034  
> Focus: Jakarta Connectors / JCA inbound and outbound architecture  
> Java range: Java 8 sampai Java 25  
> Namespace range: `javax.resource.*` dan `jakarta.resource.*`

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita membangun mental model bahwa **Jakarta Connectors / JCA** bukan sekadar API kuno, melainkan **kontrak standar antara application server dan Enterprise Information System (EIS)**.

Bagian ini memperdalam sisi arsitektur:

1. Bagaimana aplikasi Java EE / Jakarta EE **memanggil EIS** melalui **outbound resource adapter**.
2. Bagaimana EIS **memanggil aplikasi** melalui **inbound resource adapter**.
3. Apa peran `ResourceAdapter`, `ManagedConnectionFactory`, `ManagedConnection`, `ConnectionFactory`, `ActivationSpec`, `MessageEndpointFactory`, `MessageEndpoint`, dan `WorkManager`.
4. Bagaimana container mengelola lifecycle, pooling, transaction, security, thread, dan endpoint delivery.
5. Bagaimana membaca error production JCA secara struktural.
6. Kapan desain connector benar-benar lebih defensible daripada client library biasa.

Setelah bagian ini, targetnya bukan hanya bisa membaca konfigurasi JCA, tetapi bisa menjawab:

> “Di titik mana aplikasi, container, resource adapter, dan EIS berbagi tanggung jawab?”

Itu pertanyaan utama JCA.

---

## 1. Core Mental Model: JCA Adalah Boundary Antara Dua Runtime

Banyak engineer memahami integrasi seperti ini:

```text
Application Code ---> External System
```

Tetapi dalam Jakarta EE/JCA, modelnya lebih kaya:

```text
Application Component
        |
        | application contract
        v
ConnectionFactory / Endpoint Contract
        |
        | system contract
        v
Application Server / Connector Container
        |
        | resource adapter contract
        v
Resource Adapter
        |
        | EIS protocol/client API
        v
Enterprise Information System
```

JCA ada karena enterprise integration biasanya membutuhkan hal-hal yang tidak cukup diselesaikan oleh `new Client()`:

- connection pooling,
- transaction enlistment,
- XA recovery,
- credential mapping,
- endpoint activation,
- thread management,
- work scheduling,
- lifecycle management,
- deployment-time configuration,
- observability,
- security propagation,
- inbound message delivery,
- failover/reconnect behavior,
- container-managed resource governance.

Dengan kata lain:

> Client library biasa menghubungkan aplikasi ke sistem eksternal.  
> Resource adapter menghubungkan **runtime aplikasi** ke **runtime sistem eksternal**.

Perbedaannya besar.

---

## 2. Outbound vs Inbound: Dua Arah Integrasi

JCA punya dua arsitektur utama.

### 2.1 Outbound Resource Adapter

Outbound berarti aplikasi memulai interaksi.

```text
Application ---> EIS
```

Contoh:

- aplikasi memanggil mainframe transaction,
- aplikasi membuka koneksi ke ERP,
- aplikasi mengirim request ke legacy system,
- aplikasi menulis message ke proprietary queue,
- aplikasi membaca/writing file melalui enterprise adapter,
- aplikasi melakukan lookup data customer di EIS.

Diagram:

```text
+-------------------------+
| Jakarta EE Application  |
|                         |
|  @Resource              |
|  MyConnectionFactory    |
+-----------+-------------+
            |
            | getConnection()
            v
+-----------+-------------+
| Application Server      |
| Connection Manager      |
| Pool / Tx / Security    |
+-----------+-------------+
            |
            | allocateConnection(...)
            v
+-----------+-------------+
| Resource Adapter        |
| ManagedConnectionFactory|
| ManagedConnection       |
+-----------+-------------+
            |
            | EIS protocol
            v
+-----------+-------------+
| Enterprise System       |
+-------------------------+
```

Outbound adalah model yang paling mirip dengan JDBC, tetapi lebih generik.

JDBC:

```text
DataSource -> Connection -> Database
```

JCA outbound:

```text
ConnectionFactory -> Connection -> Any EIS
```

Tetapi di baliknya ada:

```text
ManagedConnectionFactory -> ManagedConnection -> physical connection
```

Perbedaan public connection dan managed connection sangat penting.

---

### 2.2 Inbound Resource Adapter

Inbound berarti EIS memulai interaksi ke aplikasi.

```text
EIS ---> Application
```

Contoh:

- message broker mengirim message ke MDB/message endpoint,
- ERP mengirim event ke application server,
- mainframe transaction callback,
- file/event adapter mendeteksi file baru lalu memanggil endpoint,
- proprietary queue mengirim task ke aplikasi.

Diagram:

```text
+-------------------------+
| Enterprise System       |
| Queue/Event/Callback    |
+-----------+-------------+
            |
            | external event
            v
+-----------+-------------+
| Resource Adapter        |
| Listener / Poller       |
| Work scheduling         |
+-----------+-------------+
            |
            | MessageEndpointFactory
            v
+-----------+-------------+
| Application Server      |
| Endpoint lifecycle      |
| Tx / Security / Threads |
+-----------+-------------+
            |
            | invoke endpoint method
            v
+-----------+-------------+
| Message Endpoint        |
| MDB / endpoint object   |
+-------------------------+
```

Inbound adalah model yang lebih sulit karena ada beberapa pertanyaan kritikal:

- Siapa yang membuat thread?
- Siapa yang mengatur transaksi?
- Siapa yang membuat endpoint instance?
- Bagaimana concurrency dikontrol?
- Bagaimana poison message ditangani?
- Bagaimana resource adapter tahu endpoint mana yang aktif?
- Bagaimana credential/security context diterapkan?
- Bagaimana shutdown dilakukan tanpa kehilangan message?

JCA menjawab pertanyaan ini lewat kontrak seperti:

- `ResourceAdapter.endpointActivation(...)`,
- `ActivationSpec`,
- `MessageEndpointFactory`,
- `MessageEndpoint`,
- `WorkManager`,
- transaction inflow,
- message inflow.

---

## 3. Komponen Arsitektur Utama

Mari petakan komponen inti.

### 3.1 `ResourceAdapter`

`ResourceAdapter` adalah instance adapter utama yang dikelola container.

Tanggung jawab:

- lifecycle adapter,
- startup/shutdown,
- endpoint activation/deactivation,
- bootstrap context access,
- koordinasi koneksi/worker/listener,
- validasi endpoint activation,
- interaksi dengan container service seperti `WorkManager` dan transaction support.

Secara mental:

```text
ResourceAdapter = runtime root object untuk adapter
```

Contoh conceptual skeleton:

```java
@Connector(
    displayName = "Legacy Payment Resource Adapter",
    vendorName = "Example Corp",
    version = "1.0"
)
public class LegacyPaymentResourceAdapter implements ResourceAdapter {

    private BootstrapContext bootstrapContext;
    private volatile boolean running;

    @Override
    public void start(BootstrapContext ctx) throws ResourceAdapterInternalException {
        this.bootstrapContext = ctx;
        this.running = true;
        // initialize RA-wide resources: schedulers, metadata, health hooks
    }

    @Override
    public void stop() {
        this.running = false;
        // stop listeners, close shared resources, drain workers
    }

    @Override
    public void endpointActivation(
            MessageEndpointFactory endpointFactory,
            ActivationSpec spec
    ) throws ResourceException {
        // start inbound listener/poller for this endpoint activation
    }

    @Override
    public void endpointDeactivation(
            MessageEndpointFactory endpointFactory,
            ActivationSpec spec
    ) {
        // stop inbound listener/poller for this endpoint activation
    }

    @Override
    public XAResource[] getXAResources(ActivationSpec[] specs) throws ResourceException {
        // return XA resources for recovery when supported
        return new XAResource[0];
    }
}
```

Important point:

> `ResourceAdapter` bukan object per request. Ia adalah container-managed component dengan lifecycle panjang.

Karena itu, kesalahan umum:

- menyimpan request state di `ResourceAdapter`,
- membuat unmanaged thread manual,
- tidak menghentikan listener saat `stop()`,
- tidak memisahkan RA-wide config dan activation-specific config,
- tidak membuat cleanup idempotent.

---

### 3.2 `BootstrapContext`

`BootstrapContext` diberikan ke `ResourceAdapter.start(...)`.

Melalui objek ini adapter bisa memperoleh container service, terutama:

- `WorkManager`,
- `XATerminator`,
- timer/transaction-related service tergantung container.

Mental model:

```text
BootstrapContext = pintu adapter ke service container
```

JCA tidak ingin resource adapter membuat thread seenaknya sendiri.

Kenapa?

Karena application server harus bisa mengontrol:

- thread limit,
- shutdown,
- security context,
- transaction context,
- monitoring,
- prioritization,
- resource isolation.

Maka inbound listener/poller sebaiknya menggunakan `WorkManager`, bukan `new Thread(...)` sembarangan.

---

### 3.3 `WorkManager`

`WorkManager` adalah service container untuk menjalankan unit kerja dari resource adapter.

Mental model:

```text
WorkManager = container-managed executor untuk resource adapter
```

Contoh conceptual:

```java
WorkManager workManager = bootstrapContext.getWorkManager();
workManager.scheduleWork(new Work() {
    @Override
    public void run() {
        pollExternalSystemAndDeliverMessages();
    }

    @Override
    public void release() {
        // asked to stop
    }
});
```

Tetapi jangan samakan langsung dengan `ExecutorService` biasa.

`WorkManager` berada dalam kontrak container. Ia bisa berhubungan dengan:

- lifecycle,
- thread governance,
- context propagation,
- work rejection,
- graceful shutdown,
- long-running work,
- transaction/security work context.

#### 3.3.1 WorkManager Failure Model

Ketika inbound adapter tidak jalan, root cause sering salah satu dari:

| Gejala | Kemungkinan Penyebab |
|---|---|
| Listener tidak start | `endpointActivation` gagal, activation config invalid, dependency missing |
| Poller jalan tapi lambat | WorkManager thread exhausted, EIS latency, lock contention |
| Shutdown lama | Work tidak respond ke `release()`, blocking I/O tanpa timeout |
| Message duplicate | transaction boundary salah, ack dilakukan sebelum commit, retry tidak idempotent |
| Message hilang | ack terlalu cepat, exception swallowed, no dead-letter strategy |
| Server hang | RA membuat unmanaged thread, infinite polling, no backoff |

Top 1% engineer membaca problem ini dari boundary, bukan dari stack trace saja.

---

### 3.4 `ManagedConnectionFactory`

`ManagedConnectionFactory` adalah factory untuk physical/managed connection.

Mental model:

```text
ManagedConnectionFactory = definisi bagaimana membuat koneksi fisik ke EIS
```

Tanggung jawab:

- menyimpan konfigurasi koneksi,
- membuat `ManagedConnection`,
- membuat public `ConnectionFactory`,
- mendukung connection matching,
- mendukung credential-aware connection creation,
- menyediakan metadata adapter.

Conceptual skeleton:

```java
public class LegacyManagedConnectionFactory
        implements ManagedConnectionFactory {

    private String host;
    private int port;
    private String systemId;

    @Override
    public Object createConnectionFactory(ConnectionManager cxManager)
            throws ResourceException {
        return new LegacyConnectionFactoryImpl(this, cxManager);
    }

    @Override
    public Object createConnectionFactory()
            throws ResourceException {
        // non-managed environment fallback
        return new LegacyConnectionFactoryImpl(this, null);
    }

    @Override
    public ManagedConnection createManagedConnection(
            Subject subject,
            ConnectionRequestInfo requestInfo
    ) throws ResourceException {
        // create physical connection to EIS
        return new LegacyManagedConnection(host, port, subject, requestInfo);
    }

    @Override
    public ManagedConnection matchManagedConnections(
            Set connectionSet,
            Subject subject,
            ConnectionRequestInfo requestInfo
    ) throws ResourceException {
        // decide whether existing pooled physical connection can satisfy request
        return null;
    }

    @Override
    public PrintWriter getLogWriter() throws ResourceException {
        return null;
    }

    @Override
    public void setLogWriter(PrintWriter out) throws ResourceException {
    }
}
```

Important distinction:

```text
ManagedConnectionFactory != application-facing connection factory
```

Application sees:

```java
LegacyConnectionFactory factory;
LegacyConnection conn = factory.getConnection();
```

Container/RA sees:

```text
ManagedConnectionFactory -> ManagedConnection -> physical EIS connection
```

---

### 3.5 `ConnectionFactory`

`ConnectionFactory` adalah object yang dipakai aplikasi.

Contoh:

```java
@Resource(lookup = "java:/eis/LegacyPayment")
private LegacyConnectionFactory paymentFactory;

public PaymentResult submit(PaymentRequest request) {
    try (LegacyConnection conn = paymentFactory.getConnection()) {
        return conn.submitPayment(request);
    }
}
```

Dari sudut pandang aplikasi, ini mirip `DataSource`.

Tetapi di balik `getConnection()` biasanya terjadi:

```text
Application calls getConnection()
    -> ConnectionFactory delegates to ConnectionManager
    -> Container checks pool/security/transaction
    -> Container calls ManagedConnectionFactory
    -> ManagedConnection acquired/matched/created
    -> Application gets connection handle
```

Connection handle bukan physical connection. Ia adalah façade/handle yang bisa di-associate/disassociate dari `ManagedConnection`.

---

### 3.6 `ConnectionManager`

`ConnectionManager` biasanya disediakan container.

Mental model:

```text
ConnectionManager = container-side brain untuk outbound connection allocation
```

Tanggung jawab:

- pooling,
- transaction enlistment,
- security credential mapping,
- connection matching,
- lazy enlistment,
- connection cleanup,
- leak detection,
- connection event handling.

Resource adapter portable tidak seharusnya mengimplementasikan pooling sendiri apabila dideploy di managed environment. Ia menyerahkan ke container melalui system contract.

---

### 3.7 `ManagedConnection`

`ManagedConnection` adalah representasi koneksi fisik/logis ke EIS yang dikelola container.

Tanggung jawab:

- membuat application connection handle,
- cleanup handle,
- destroy physical connection,
- expose local/XA transaction,
- notify connection events,
- associate connection handle,
- maintain physical EIS session/socket/protocol state.

Conceptual skeleton:

```java
public class LegacyManagedConnection implements ManagedConnection {

    private final List<ConnectionEventListener> listeners = new CopyOnWriteArrayList<>();
    private LegacyPhysicalSession physicalSession;

    @Override
    public Object getConnection(Subject subject, ConnectionRequestInfo cxRequestInfo)
            throws ResourceException {
        return new LegacyConnectionHandle(this);
    }

    @Override
    public void destroy() throws ResourceException {
        physicalSession.close();
    }

    @Override
    public void cleanup() throws ResourceException {
        // reset per-use state before returning to pool
    }

    @Override
    public void associateConnection(Object connection) throws ResourceException {
        ((LegacyConnectionHandle) connection).associate(this);
    }

    @Override
    public void addConnectionEventListener(ConnectionEventListener listener) {
        listeners.add(listener);
    }

    @Override
    public void removeConnectionEventListener(ConnectionEventListener listener) {
        listeners.remove(listener);
    }

    @Override
    public XAResource getXAResource() throws ResourceException {
        throw new NotSupportedException("XA not supported");
    }

    @Override
    public LocalTransaction getLocalTransaction() throws ResourceException {
        return new LegacyLocalTransaction(physicalSession);
    }

    @Override
    public ManagedConnectionMetaData getMetaData() throws ResourceException {
        return new LegacyMetadata();
    }

    @Override
    public void setLogWriter(PrintWriter out) throws ResourceException {
    }

    @Override
    public PrintWriter getLogWriter() throws ResourceException {
        return null;
    }
}
```

#### Critical invariant

Sebelum pooled connection dikembalikan ke pool, state harus bersih.

Misalnya:

- pending transaction tidak boleh tertinggal,
- cursor/result stream harus ditutup,
- user/session state harus reset,
- request-specific flags harus dihapus,
- temporary buffer harus dilepas,
- logical handle harus detached.

Jika tidak, bug yang muncul biasanya intermittent dan sangat sulit dicari.

---

## 4. Outbound Architecture Deep Dive

### 4.1 Outbound Flow Lengkap

```text
1. Application obtains ConnectionFactory via injection/JNDI.
2. Application calls getConnection().
3. ConnectionFactory creates ConnectionRequestInfo if needed.
4. ConnectionFactory calls ConnectionManager.allocateConnection(mcf, cri).
5. Container checks current transaction/security context.
6. Container tries to match existing ManagedConnection from pool.
7. If no match, container asks MCF to create ManagedConnection.
8. ManagedConnection creates application connection handle.
9. Application uses handle.
10. Application closes handle.
11. ManagedConnection notifies close event.
12. Container dissociates handle and returns ManagedConnection to pool.
13. On error, container destroys or invalidates ManagedConnection.
```

Simplified sequence:

```text
Application
  -> ConnectionFactory.getConnection()
    -> ConnectionManager.allocateConnection()
      -> ManagedConnectionFactory.match/createManagedConnection()
        -> ManagedConnection.getConnection()
          -> ConnectionHandle
```

### 4.2 Application Contract vs System Contract

| Layer | API | Audience | Purpose |
|---|---|---|---|
| Application contract | `ConnectionFactory`, `Connection`, `Interaction`-like API | Business application | Use EIS capability |
| System contract | `ManagedConnectionFactory`, `ManagedConnection`, `ConnectionManager` | Container + RA | Manage lifecycle/pool/tx/security |
| EIS contract | proprietary protocol/client | RA + external system | Actual integration |

A well-designed adapter hides system complexity from application code.

Bad design exposes:

- physical session,
- transaction internals,
- socket timeout mutation per call,
- container-specific pooling assumptions,
- vendor-specific exception chaos,
- reconnect loops inside business method.

Good design exposes:

- meaningful operations,
- clear checked/unchecked exception taxonomy,
- deterministic lifecycle,
- close semantics,
- timeout configuration through administered/config property,
- idempotency/correlation hooks.

---

### 4.3 Connection Handle Design

A connection handle should be lightweight.

Example conceptual:

```java
public final class LegacyConnectionHandle implements AutoCloseable {

    private LegacyManagedConnection managedConnection;
    private boolean closed;

    LegacyConnectionHandle(LegacyManagedConnection managedConnection) {
        this.managedConnection = managedConnection;
    }

    public PaymentResult submitPayment(PaymentCommand command) {
        ensureOpen();
        return managedConnection.submitPayment(command);
    }

    @Override
    public void close() {
        if (!closed) {
            closed = true;
            managedConnection.connectionClosed(this);
        }
    }

    void associate(LegacyManagedConnection newManagedConnection) {
        this.managedConnection = newManagedConnection;
        this.closed = false;
    }

    private void ensureOpen() {
        if (closed) {
            throw new IllegalStateException("Connection handle is closed");
        }
    }
}
```

Key principles:

- Application closes handle, not necessarily physical connection.
- Physical connection returns to pool.
- Handle must not be reused after close.
- Handle must not leak `ManagedConnection` internals.
- Handle should be deterministic under exceptions.

---

### 4.4 Connection Matching

`matchManagedConnections(...)` matters when pool contains multiple physical connections with different properties.

Examples of matching dimensions:

- username/credential,
- tenant/system id,
- language/locale session,
- EIS endpoint,
- client certificate alias,
- transaction capability,
- request-specific mode,
- read-only vs read-write.

Dangerous mistake:

```text
Pool reuses connection created for User A / Tenant A for User B / Tenant B.
```

This is not just bug. It can become data leakage.

Therefore connection matching must be conservative.

If uncertain:

```text
Do not match.
```

Conservative matching costs performance. Incorrect matching costs security and correctness.

---

### 4.5 Outbound Transaction Model

Outbound connector may support:

| Mode | Meaning | Example |
|---|---|---|
| No transaction | Operation independent | stateless query, non-transactional API |
| Local transaction | Transaction only within EIS resource | commit/rollback on single EIS session |
| XA transaction | Distributed transaction across resources | DB + EIS atomic transaction |

The trap:

> XA support is not a checkbox. It requires recovery semantics.

If adapter claims XA but cannot recover after crash, it may be worse than no XA.

Questions to ask:

- Does EIS support prepare/commit/rollback?
- Is `Xid` persisted durably?
- Can in-doubt transaction be recovered after JVM crash?
- Are duplicate commit/rollback calls idempotent?
- How does timeout map to EIS transaction timeout?
- What happens if network fails after prepare?

If answers are vague, do not pretend XA.

---

### 4.6 Outbound Security Model

Credential flow can be:

```text
Application identity -> Container subject -> RA credential -> EIS credential
```

Models:

| Model | Description |
|---|---|
| Container-managed sign-on | Container maps app/user identity to EIS credentials |
| Component-managed sign-on | Application passes credentials/request info |
| Static service account | Adapter uses configured technical account |
| Per-tenant credential | Tenant-specific credential mapping |
| Certificate-based | Adapter uses cert/key alias to authenticate to EIS |

Security failure examples:

- pooled connection not separated by identity,
- static service account used for all operations without audit user propagation,
- password stored in adapter config without secret management,
- credential changed but pool not refreshed,
- reconnect uses stale credential,
- user identity not included in EIS audit trail.

In regulated systems, the question is not just:

```text
Can the system connect?
```

It is:

```text
Can we prove who caused each external operation?
```

---

## 5. Inbound Architecture Deep Dive

Inbound architecture is more abstract because application code may not call the adapter directly. Instead, the container and resource adapter coordinate endpoint delivery.

### 5.1 Inbound Flow Lengkap

```text
1. Application deploys message endpoint/MDB with activation configuration.
2. Container creates ActivationSpec from deployment metadata.
3. Container validates ActivationSpec.
4. Container calls ResourceAdapter.endpointActivation(endpointFactory, activationSpec).
5. ResourceAdapter starts listener/poller/subscription to EIS.
6. EIS event/message arrives.
7. RA schedules work using WorkManager.
8. RA obtains MessageEndpoint from MessageEndpointFactory.
9. RA invokes endpoint method.
10. Container applies transaction/security/interceptor lifecycle.
11. Endpoint completes or throws exception.
12. RA/container performs ack/commit/rollback/retry/dead-letter according to contract.
13. On undeploy/shutdown, container calls endpointDeactivation.
```

Sequence:

```text
Container
  -> ResourceAdapter.endpointActivation(endpointFactory, activationSpec)
    -> RA listener/poller starts
      -> EIS message arrives
        -> WorkManager.scheduleWork(...)
          -> endpointFactory.createEndpoint(...)
            -> MessageEndpoint.beforeDelivery(...)
              -> invoke business method
            -> MessageEndpoint.afterDelivery()
```

Not every implementation exposes these calls visibly, but this is the conceptual flow.

---

### 5.2 `ActivationSpec`

`ActivationSpec` holds endpoint-specific inbound configuration.

Mental model:

```text
ActivationSpec = subscription/listener configuration for one inbound endpoint
```

Examples:

- queue name,
- topic name,
- subscription id,
- polling interval,
- batch size,
- max concurrency,
- selector/filter,
- endpoint mode,
- retry policy,
- dead-letter target,
- tenant/system id,
- acknowledgement mode,
- transaction mode.

Conceptual skeleton:

```java
public class LegacyActivationSpec implements ActivationSpec {

    private ResourceAdapter resourceAdapter;

    private String queueName;
    private int maxConcurrency = 5;
    private long pollIntervalMillis = 1000;

    @Override
    public void validate() throws InvalidPropertyException {
        if (queueName == null || queueName.isBlank()) {
            throw new InvalidPropertyException("queueName is required");
        }
        if (maxConcurrency <= 0) {
            throw new InvalidPropertyException("maxConcurrency must be positive");
        }
    }

    @Override
    public ResourceAdapter getResourceAdapter() {
        return resourceAdapter;
    }

    @Override
    public void setResourceAdapter(ResourceAdapter ra) throws ResourceException {
        this.resourceAdapter = ra;
    }

    public String getQueueName() {
        return queueName;
    }

    public void setQueueName(String queueName) {
        this.queueName = queueName;
    }

    public int getMaxConcurrency() {
        return maxConcurrency;
    }

    public void setMaxConcurrency(int maxConcurrency) {
        this.maxConcurrency = maxConcurrency;
    }
}
```

Rules:

- validate config early,
- no hidden defaults for dangerous properties,
- make concurrency explicit,
- make retry/ack behavior explicit,
- separate adapter-wide config from endpoint-specific config.

Bad activation config:

```text
queueName = null
maxConcurrency = unlimited
retry = forever
pollInterval = 0
transaction = implicit
```

Good activation config:

```text
queueName = payment.inbound
maxConcurrency = 10
batchSize = 50
pollInterval = 500ms
retry.maxAttempts = 5
deadLetter = payment.dlq
transaction = xa/local/no-tx explicitly documented
```

---

### 5.3 `MessageEndpointFactory`

The container provides `MessageEndpointFactory` to the resource adapter.

Mental model:

```text
MessageEndpointFactory = safe factory for container-managed endpoint instances
```

Resource adapter should not instantiate endpoint classes directly.

Why?

Because endpoint invocation may involve:

- dependency injection,
- transaction interceptor,
- security context,
- lifecycle callbacks,
- pooling,
- concurrency control,
- exception handling,
- metrics/tracing,
- container-managed proxy.

Correct mental model:

```text
RA receives event -> asks container for endpoint -> invokes through container-managed endpoint
```

Wrong mental model:

```text
RA new MyEndpoint() -> calls method directly
```

The second bypasses Jakarta EE runtime semantics.

---

### 5.4 `MessageEndpoint`

`MessageEndpoint` represents an endpoint instance prepared by the container.

It supports delivery lifecycle methods conceptually like:

```text
beforeDelivery(method)
invoke message listener method
afterDelivery()
release()
```

This allows the container to manage transaction boundary around message delivery.

Conceptual flow:

```java
MessageEndpoint endpoint = endpointFactory.createEndpoint(xaResource);
try {
    endpoint.beforeDelivery(onMessageMethod);
    ((LegacyMessageListener) endpoint).onMessage(message);
    endpoint.afterDelivery();
} catch (Throwable ex) {
    // handle rollback/retry/failure
} finally {
    endpoint.release();
}
```

In actual implementations, message listener interfaces and endpoint proxies vary, but the key point is stable:

> Endpoint invocation must pass through the container’s endpoint lifecycle.

---

### 5.5 Inbound Listener / Poller Design

There are two broad styles.

#### Push listener

```text
EIS pushes event to RA listener callback.
RA delivers event to endpoint.
```

Good for:

- broker callbacks,
- server push,
- persistent subscription,
- long-lived protocol session.

Risks:

- callback thread may be EIS-owned,
- backpressure harder,
- reconnect logic complex,
- must not invoke endpoint directly on unmanaged thread if container context needed.

#### Poller

```text
RA periodically polls EIS.
RA delivers fetched messages to endpoint.
```

Good for:

- legacy systems without push,
- file polling,
- database polling,
- batch-oriented integration.

Risks:

- duplicate fetch,
- concurrent poll overlap,
- inefficient empty polling,
- lock contention,
- watermark correctness,
- backoff strategy.

A mature adapter defines:

- polling interval,
- jitter,
- max batch size,
- max concurrency,
- lease/lock semantics,
- visibility timeout,
- duplicate detection,
- checkpoint/watermark,
- graceful shutdown behavior.

---

## 6. Endpoint Activation and Deactivation

### 6.1 Activation

`endpointActivation` is called when the container wants a resource adapter to start delivering messages to a specific endpoint.

Conceptual code:

```java
@Override
public void endpointActivation(
        MessageEndpointFactory endpointFactory,
        ActivationSpec spec
) throws ResourceException {

    LegacyActivationSpec activation = (LegacyActivationSpec) spec;
    activation.validate();

    InboundConsumer consumer = new InboundConsumer(
        bootstrapContext.getWorkManager(),
        endpointFactory,
        activation,
        eisClientFactory
    );

    consumers.put(activation.identity(), consumer);
    consumer.start();
}
```

The adapter should:

- validate activation spec,
- create endpoint-specific listener/poller,
- register it safely,
- start work through `WorkManager`,
- support multiple activations,
- fail activation loudly if required config invalid.

Do not:

- swallow activation error,
- start duplicate listener for same endpoint,
- use global mutable config accidentally,
- let activation start with partial config,
- ignore transaction capability mismatch.

---

### 6.2 Deactivation

`endpointDeactivation` is called when endpoint should stop receiving messages.

Conceptual:

```java
@Override
public void endpointDeactivation(
        MessageEndpointFactory endpointFactory,
        ActivationSpec spec
) {
    LegacyActivationSpec activation = (LegacyActivationSpec) spec;
    InboundConsumer consumer = consumers.remove(activation.identity());
    if (consumer != null) {
        consumer.stopGracefully();
    }
}
```

Deactivation must be:

- idempotent,
- fast enough,
- safe under concurrent delivery,
- able to stop polling/listener,
- able to drain or reject in-flight messages according to policy,
- able to avoid new endpoint delivery after deactivation starts.

A frequent production bug:

```text
Application undeploys, but resource adapter listener continues running.
```

Symptoms:

- classloader leak,
- stale endpoint invocation,
- duplicate consumers after redeploy,
- memory leak,
- old config still receiving messages,
- server cannot shutdown cleanly.

---

## 7. Inbound Transaction and Acknowledgement

Inbound integration lives or dies on ack timing.

### 7.1 The Ack Timing Problem

Suppose a message arrives:

```text
1. RA receives message.
2. RA invokes endpoint.
3. Endpoint writes to database.
4. Endpoint completes.
5. Message is acknowledged/committed.
```

If ack happens before DB commit:

```text
Message lost if DB commit fails.
```

If DB commits but ack fails:

```text
Message redelivered, causing duplicate processing.
```

Therefore endpoint code must be idempotent.

No transaction model eliminates distributed failure completely unless both systems truly participate in recoverable XA and recovery is correctly configured.

### 7.2 Common Inbound Delivery Semantics

| Semantics | Meaning | Practical Requirement |
|---|---|---|
| At-most-once | Message may be lost, not duplicated | Ack before processing or no retry |
| At-least-once | Message not lost, may duplicate | Idempotency required |
| Exactly-once illusion | Appears once at business level | Idempotency + transaction/reconciliation |

Top-level rule:

> Design business effects as idempotent. Do not rely purely on connector delivery guarantee.

### 7.3 Idempotency Strategies

Use one or more:

- external message id,
- business command id,
- correlation id,
- dedup table,
- unique constraint,
- inbox table,
- processed event ledger,
- compare-and-set state transition,
- deterministic operation key,
- status machine invariant.

Example:

```sql
CREATE TABLE inbound_message_ledger (
    source_system      VARCHAR2(100) NOT NULL,
    message_id         VARCHAR2(200) NOT NULL,
    received_at        TIMESTAMP NOT NULL,
    processed_at       TIMESTAMP,
    processing_status  VARCHAR2(30) NOT NULL,
    error_code         VARCHAR2(100),
    PRIMARY KEY (source_system, message_id)
);
```

Pseudo flow:

```text
Start transaction
  insert ledger(source, messageId, RECEIVED)
  if duplicate -> return success without reapplying side effect
  apply business transition
  mark ledger PROCESSED
Commit transaction
Ack message
```

If ack fails after commit, redelivery hits duplicate ledger and becomes safe.

---

## 8. Work Management and Backpressure

Inbound adapter can destroy the application if it delivers faster than application can process.

### 8.1 Bad Design

```text
while true:
  messages = fetch unlimited
  for each message:
    start new thread
```

Problems:

- unbounded memory,
- unbounded threads,
- transaction timeout,
- DB saturation,
- duplicate processing,
- shutdown failure,
- backpressure ignored.

### 8.2 Better Design

```text
bounded poll -> bounded work scheduling -> bounded endpoint concurrency -> retry/dead-letter
```

Parameters:

| Parameter | Purpose |
|---|---|
| `maxConcurrency` | cap endpoint invocations |
| `batchSize` | cap messages fetched per poll |
| `pollInterval` | control empty polling cost |
| `backoff` | reduce pressure on failure |
| `visibilityTimeout` | avoid duplicate while processing |
| `deliveryTimeout` | avoid stuck endpoint invocation |
| `maxAttempts` | prevent infinite poison loop |
| `deadLetterTarget` | isolate poison messages |

### 8.3 Backpressure Rule

The connector should obey downstream capacity.

```text
EIS capacity > RA capacity > application capacity > database capacity
```

The slowest reliable component should shape throughput.

If DB can process 100 msg/sec, do not let RA deliver 1000 msg/sec just because EIS can.

---

## 9. Deployment Descriptor and Annotation Model

Historically, JCA resource adapters are packaged as `.rar` files.

```text
legacy-adapter.rar
  META-INF/ra.xml
  classes / jars
```

Modern specs also allow annotations for many metadata aspects, but deployment descriptors still matter in real enterprise environments because:

- ops teams configure without rebuilding,
- app server vendor features live in descriptors/admin config,
- security credentials should not be hardcoded,
- activation specs are often environment-specific,
- pool config is container-specific.

### 9.1 `ra.xml` Mental Model

`ra.xml` describes adapter metadata:

- adapter class,
- outbound connection definitions,
- managed connection factory class,
- connection factory interface/impl,
- connection interface/impl,
- transaction support,
- authentication mechanism,
- inbound message listener type,
- activation spec class,
- required config properties,
- administered objects.

Conceptual minimal shape:

```xml
<connector xmlns="https://jakarta.ee/xml/ns/jakartaee"
           version="2.1">

  <display-name>Legacy Payment Adapter</display-name>
  <vendor-name>Example Corp</vendor-name>
  <eis-type>LegacyPayment</eis-type>
  <resourceadapter-version>1.0</resourceadapter-version>

  <resourceadapter>
    <resourceadapter-class>
      com.example.ra.LegacyPaymentResourceAdapter
    </resourceadapter-class>

    <outbound-resourceadapter>
      <connection-definition>
        <managedconnectionfactory-class>
          com.example.ra.LegacyManagedConnectionFactory
        </managedconnectionfactory-class>
        <connectionfactory-interface>
          com.example.api.LegacyConnectionFactory
        </connectionfactory-interface>
        <connectionfactory-impl-class>
          com.example.ra.LegacyConnectionFactoryImpl
        </connectionfactory-impl-class>
        <connection-interface>
          com.example.api.LegacyConnection
        </connection-interface>
        <connection-impl-class>
          com.example.ra.LegacyConnectionHandle
        </connection-impl-class>
      </connection-definition>
      <transaction-support>LocalTransaction</transaction-support>
    </outbound-resourceadapter>

    <inbound-resourceadapter>
      <messageadapter>
        <messagelistener>
          <messagelistener-type>
            com.example.api.LegacyMessageListener
          </messagelistener-type>
          <activationspec>
            <activationspec-class>
              com.example.ra.LegacyActivationSpec
            </activationspec-class>
          </activationspec>
        </messagelistener>
      </messageadapter>
    </inbound-resourceadapter>
  </resourceadapter>
</connector>
```

Exact descriptor syntax may vary by spec version/vendor examples, but the mental model is stable.

### 9.2 Container-Specific Configuration

Portable descriptor defines adapter capabilities. Runtime config often lives in app server configuration.

Examples:

- JNDI name,
- pool min/max,
- blocking timeout,
- idle timeout,
- credential alias,
- recovery credential,
- endpoint activation config,
- WorkManager/thread pool binding,
- reconnect policy,
- validation policy.

This means connector deployment is a collaboration between:

- developer,
- platform engineer,
- app server admin,
- security admin,
- external system owner.

---

## 10. Classloading and Packaging

JCA adapters are notorious for classloading issues.

### 10.1 Common Packaging Problem

```text
Application includes EIS client v1.
Resource adapter includes EIS client v2.
Server module includes EIS client v3.
```

Symptoms:

- `ClassCastException`,
- `NoSuchMethodError`,
- `LinkageError`,
- duplicate API interfaces,
- endpoint interface loaded by different classloader,
- connection factory injection fails,
- resource adapter works in one server but not another.

### 10.2 Rule of Thumb

Public application-facing interfaces must be visible consistently to both application and adapter.

But physical implementation dependencies should remain inside adapter/server module.

Think in layers:

```text
Application-visible API
  - ConnectionFactory interface
  - Connection interface
  - MessageListener interface

Adapter implementation
  - ManagedConnectionFactory
  - ManagedConnection
  - protocol client
  - parser/codec

Server/container
  - jakarta.resource API
  - transaction manager
  - WorkManager
```

Do not duplicate incompatible copies of the same public API in multiple places.

### 10.3 Java 8 to Java 25 Namespace Concerns

For Java EE era:

```java
javax.resource.spi.ResourceAdapter
javax.resource.spi.ManagedConnectionFactory
javax.resource.spi.ActivationSpec
```

For Jakarta era:

```java
jakarta.resource.spi.ResourceAdapter
jakarta.resource.spi.ManagedConnectionFactory
jakarta.resource.spi.ActivationSpec
```

Migration is not source-compatible if package names change.

You must align:

- app server version,
- resource adapter API namespace,
- application imports,
- descriptor namespace/version,
- dependencies,
- vendor RA version.

A `javax.resource` adapter usually cannot simply run as `jakarta.resource` without transformation/rebuild, unless the container provides compatibility transformation.

Do not assume.

---

## 11. Administered Objects

Resource adapters can expose administered objects.

Mental model:

```text
Administered object = configured object representing EIS destination/resource metadata
```

Examples:

- queue destination,
- topic destination,
- endpoint address,
- routing target,
- channel definition,
- file drop location,
- logical EIS resource.

Why useful?

Because application should not hardcode environment-specific EIS resource names.

Instead of:

```java
factory.send("PROD.PAYMENT.QUEUE", message);
```

Prefer:

```java
@Resource(lookup = "java:/eis/paymentQueue")
private LegacyDestination paymentQueue;
```

Then ops can map:

```text
DEV -> DEV.PAYMENT.QUEUE
UAT -> UAT.PAYMENT.QUEUE
PROD -> PROD.PAYMENT.QUEUE
```

This supports environment portability.

---

## 12. Error Taxonomy in JCA Architecture

A mature connector design defines error categories.

### 12.1 Outbound Errors

| Category | Example | Handling |
|---|---|---|
| Configuration error | missing host, invalid credential alias | fail fast at deployment/startup |
| Allocation error | pool exhausted, matching failed | retry only if capacity issue; alert |
| Authentication error | EIS rejects credential | fail fast; rotate credential |
| Protocol error | malformed EIS response | mark adapter/client bug or contract mismatch |
| Business rejection | external system rejects command | return business error, no infra retry |
| Transient transport | timeout, connection reset | retry if idempotent |
| Transaction error | commit/rollback failure | recovery/reconciliation |
| Resource leak | connection not closed | leak detection, code fix |

### 12.2 Inbound Errors

| Category | Example | Handling |
|---|---|---|
| Activation error | invalid queue name | fail deployment/activation |
| Listener error | cannot subscribe/connect | reconnect with bounded backoff, alert |
| Delivery error | endpoint throws exception | rollback/retry according to policy |
| Poison message | same message always fails | dead-letter/quarantine |
| Duplicate message | redelivery after commit/ack failure | idempotency ledger |
| Backpressure | endpoint slow, queue grows | throttle, scale, tune concurrency |
| Shutdown error | in-flight work not stopping | improve lifecycle, timeouts |
| Transaction inflow error | XA enlist/recovery failure | recovery tooling, disable false XA |

### 12.3 Exception Mapping Principle

Do not expose raw vendor chaos to application.

Bad:

```java
throw new RuntimeException(e);
```

Better:

```java
throw new LegacyConnectionUnavailableException(
    "EIS connection unavailable",
    errorCode,
    retryable,
    correlationId,
    e
);
```

For inbound, errors should include:

- source system,
- endpoint id,
- message id,
- activation id,
- delivery attempt,
- transaction id/Xid when safe,
- correlation id,
- failure category,
- retry decision.

---

## 13. Observability Model

JCA integration must be observable across four boundaries:

```text
Application <-> Container <-> Resource Adapter <-> EIS
```

### 13.1 Metrics

Outbound metrics:

- connection allocation latency,
- pool active/idle count,
- pool wait count,
- pool timeout count,
- operation latency by EIS command,
- transport error count,
- business rejection count,
- retry count,
- transaction commit/rollback count,
- connection destroy count.

Inbound metrics:

- activation status,
- listener connected/disconnected,
- messages fetched,
- messages delivered,
- delivery success/failure,
- retry count,
- dead-letter count,
- endpoint latency,
- in-flight deliveries,
- work queue size,
- poll duration,
- empty poll count,
- duplicate detected count.

### 13.2 Logs

A useful connector log line should answer:

```text
Which adapter?
Which activation/connection factory?
Which EIS endpoint/resource?
Which operation/message?
Which correlation id?
Which transaction boundary?
Which retry attempt?
What decision was made?
```

Example:

```text
level=ERROR
component=legacy-payment-ra
activation=payment-inbound-prod
sourceSystem=LEGACY_PAYMENT
queue=PAYMENT.IN
messageId=abc-123
attempt=4
transactionMode=LOCAL
failureCategory=BUSINESS_VALIDATION
retryDecision=DEAD_LETTER
correlationId=req-789
```

Avoid logging:

- secrets,
- full payload with PII,
- credentials,
- private keys,
- session tokens,
- raw SOAP/XML/JSON containing regulated data unless masked and approved.

### 13.3 Tracing

For outbound:

```text
HTTP/API request trace -> business service -> JCA outbound operation -> EIS correlation id
```

For inbound:

```text
EIS message id -> RA delivery -> endpoint transaction -> internal service trace
```

Important:

> Inbound message often starts a trace. There may be no upstream HTTP request.

Therefore connector should create/propagate correlation IDs from message metadata or generate one deterministically.

---

## 14. Designing a Production-Grade Outbound Adapter

### 14.1 Minimal Requirements

A serious outbound adapter should define:

- connection factory interface,
- connection handle interface,
- managed connection factory,
- managed connection,
- connection request info,
- connection matching rules,
- cleanup semantics,
- destroy semantics,
- transaction support level,
- exception taxonomy,
- timeout model,
- credential model,
- metadata/health check,
- observability hooks.

### 14.2 Outbound Checklist

Before production:

- [ ] Connection close returns handle to pool.
- [ ] Physical connection destroyed on fatal error.
- [ ] Pool matching does not leak identity/tenant state.
- [ ] `cleanup()` resets all per-use state.
- [ ] Timeouts are configured and tested.
- [ ] Transaction mode is explicit.
- [ ] XA is not claimed unless recovery works.
- [ ] Credentials are not embedded in code.
- [ ] Credential rotation behavior is known.
- [ ] Exceptions classify retryable vs non-retryable.
- [ ] Operation idempotency is documented.
- [ ] Metrics exist for pool, latency, failure.
- [ ] Load test includes pool exhaustion.
- [ ] Failure test includes EIS down/restart.
- [ ] Shutdown test closes physical sessions.

---

## 15. Designing a Production-Grade Inbound Adapter

### 15.1 Minimal Requirements

A serious inbound adapter should define:

- message listener interface,
- activation spec,
- activation validation,
- endpoint activation/deactivation,
- listener/poller lifecycle,
- WorkManager usage,
- concurrency limit,
- transaction/ack model,
- retry and dead-letter policy,
- duplicate handling recommendation,
- graceful shutdown,
- recovery behavior,
- observability hooks.

### 15.2 Inbound Checklist

Before production:

- [ ] Activation config fails fast when invalid.
- [ ] Multiple activations do not conflict accidentally.
- [ ] Listener/poller uses container-managed work.
- [ ] Concurrency is bounded.
- [ ] Polling has backoff/jitter.
- [ ] Delivery timeout is defined.
- [ ] Ack occurs at correct point relative to business transaction.
- [ ] Redelivery behavior is known.
- [ ] Poison message goes to dead-letter/quarantine.
- [ ] Endpoint exceptions are not swallowed.
- [ ] Shutdown stops new deliveries.
- [ ] In-flight messages are drained or safely retried.
- [ ] Duplicate delivery is tested.
- [ ] EIS reconnect is bounded and observable.
- [ ] Message IDs/correlation IDs are logged.

---

## 16. JCA vs JMS: Jangan Disamakan

JMS/Jakarta Messaging is a messaging API.

JCA/Jakarta Connectors is a connector architecture.

A JMS provider may expose a JCA resource adapter so application servers can integrate JMS with:

- MDB inbound delivery,
- connection pooling,
- transaction enlistment,
- XA recovery,
- administered objects.

Relationship:

```text
Jakarta Messaging API
        can be implemented/deployed through
Jakarta Connectors Resource Adapter
```

But JCA can connect to non-JMS systems too:

- SAP,
- mainframe,
- ERP,
- EIS,
- file systems,
- proprietary queues,
- legacy transaction systems.

So:

```text
JMS is one common use case of JCA, not the definition of JCA.
```

---

## 17. JCA vs Microservice Client Library

Modern systems often avoid JCA and use ordinary clients:

```text
Spring Boot service -> HTTP/gRPC/Kafka client -> external system
```

That is fine for many cases.

But JCA is still relevant when:

- running inside full Jakarta EE server,
- vendor provides certified RA,
- XA/recovery with app server transaction manager matters,
- MDB-style inbound delivery matters,
- enterprise server manages pooling/security centrally,
- EIS integration is proprietary and long-lived,
- ops team expects app-server-managed resources,
- legacy system is already standardized around adapters.

JCA may be overkill when:

- simple HTTP client is enough,
- application runs outside Jakarta EE container,
- no transaction/security inflow needed,
- scaling model is Kubernetes-native service instances,
- vendor RA quality is poor,
- app server feature support is limited,
- team lacks operational knowledge.

Decision matrix:

| Need | Client Library | JCA |
|---|---:|---:|
| Simple outbound call | Strong | Weak/overkill |
| Container-managed pooling | Medium | Strong |
| XA with app server | Weak/medium | Strong if real support |
| Inbound MDB delivery | Weak | Strong |
| Legacy vendor support | Medium | Strong if vendor RA exists |
| Kubernetes-native lightweight service | Strong | Weak |
| Full Jakarta EE server governance | Medium | Strong |
| Low complexity | Strong | Weak |

---

## 18. Failure Scenarios and Structural Diagnosis

### Scenario 1: Pool Exhaustion

Symptom:

```text
Application requests hang or fail waiting for EIS connection.
```

Possible causes:

- connection leak,
- EIS slow,
- pool too small,
- transaction holds connection too long,
- connection validation blocks,
- dead physical connections not destroyed,
- nested calls require more connections than expected.

Diagnosis:

```text
Check active count, idle count, waiters, allocation latency, operation latency, close rate.
```

Fix:

- ensure try-with-resources,
- tune timeout,
- tune pool,
- reduce transaction scope,
- add circuit breaker at operation layer,
- destroy bad connections.

### Scenario 2: Duplicate Inbound Processing

Symptom:

```text
Same external message creates duplicate business record.
```

Possible causes:

- ack failure after DB commit,
- retry after endpoint timeout,
- EIS redelivery,
- concurrent poller overlap,
- no unique message ledger,
- business operation not idempotent.

Fix:

- idempotency ledger,
- unique business command ID,
- lock/lease around polling,
- redelivery detection,
- endpoint transaction alignment.

### Scenario 3: Endpoint Still Runs After Undeploy

Symptom:

```text
Old version of application still receives messages after redeploy.
```

Possible causes:

- endpointDeactivation not stopping listener,
- unmanaged thread,
- classloader leak,
- static listener registry,
- duplicate activation key.

Fix:

- use WorkManager,
- idempotent deactivation,
- stop flag + interruptible blocking calls,
- remove static references,
- test redeploy/shutdown.

### Scenario 4: Wrong Tenant Data

Symptom:

```text
Tenant B sees data from Tenant A.
```

Possible causes:

- bad `matchManagedConnections`,
- physical session tenant context not reset,
- static credential,
- pooled connection reused across tenant-specific state,
- `cleanup()` incomplete.

Fix:

- include tenant/credential in match key,
- reset session state,
- separate pools per tenant if needed,
- stronger tests with alternating tenants.

### Scenario 5: XA Recovery Failure

Symptom:

```text
After crash, in-doubt transactions remain or duplicate commit occurs.
```

Possible causes:

- fake XA implementation,
- `getXAResources()` incomplete,
- recovery credential wrong,
- Xid not durable in EIS,
- transaction timeout mismatch,
- app server recovery not configured.

Fix:

- validate XA support end-to-end,
- test crash between prepare and commit,
- configure recovery identity,
- document reconciliation process,
- use local/idempotent pattern if XA unreliable.

---

## 19. Example: Conceptual Custom Inbound Adapter

Imagine a legacy EIS exposes a table/queue-like API:

```text
fetchPending(maxBatch)
markSuccess(messageId)
markFailure(messageId, reason)
```

A JCA inbound adapter could map it as:

```text
ActivationSpec:
  - endpointName
  - maxBatch
  - maxConcurrency
  - pollInterval
  - maxAttempts

ResourceAdapter:
  - start/stop global resources
  - endpointActivation starts one consumer
  - endpointDeactivation stops one consumer

InboundConsumer:
  - schedules poll work
  - fetches bounded batch
  - creates endpoint
  - invokes listener
  - commits/acks or fails/retries
```

Pseudo flow:

```java
final class InboundConsumer {

    private final AtomicBoolean running = new AtomicBoolean();
    private final Semaphore concurrency;
    private final WorkManager workManager;
    private final MessageEndpointFactory endpointFactory;
    private final LegacyActivationSpec spec;

    void start() throws WorkException {
        running.set(true);
        workManager.scheduleWork(new PollWork());
    }

    void stopGracefully() {
        running.set(false);
    }

    final class PollWork implements Work {
        @Override
        public void run() {
            while (running.get()) {
                try {
                    List<LegacyMessage> batch = fetchBoundedBatch();
                    for (LegacyMessage message : batch) {
                        if (!running.get()) break;
                        concurrency.acquire();
                        workManager.scheduleWork(new DeliveryWork(message, concurrency));
                    }
                    sleepWithBackoffIfEmpty(batch);
                } catch (Throwable t) {
                    logPollFailure(t);
                    sleepAfterFailure();
                }
            }
        }

        @Override
        public void release() {
            running.set(false);
        }
    }
}
```

This is conceptual only, but it shows key invariants:

- bounded fetch,
- bounded concurrency,
- WorkManager usage,
- stop signal,
- failure backoff,
- no unlimited thread creation.

---

## 20. Example: Conceptual Outbound Adapter Operation

Application code:

```java
public PaymentReceipt submitPayment(PaymentCommand command) {
    try (LegacyPaymentConnection connection = paymentFactory.getConnection()) {
        return connection.submit(command);
    }
}
```

Connection factory:

```java
public class LegacyPaymentConnectionFactoryImpl
        implements LegacyPaymentConnectionFactory {

    private final ManagedConnectionFactory mcf;
    private final ConnectionManager connectionManager;

    public LegacyPaymentConnectionFactoryImpl(
            ManagedConnectionFactory mcf,
            ConnectionManager connectionManager
    ) {
        this.mcf = mcf;
        this.connectionManager = connectionManager;
    }

    @Override
    public LegacyPaymentConnection getConnection() {
        try {
            ConnectionRequestInfo cri = new LegacyConnectionRequestInfo();
            return (LegacyPaymentConnection)
                    connectionManager.allocateConnection(mcf, cri);
        } catch (ResourceException e) {
            throw new LegacyConnectionException("Unable to allocate EIS connection", e);
        }
    }
}
```

Business code does not know:

- pool matching,
- transaction enlistment,
- physical reconnect,
- credential mapping,
- cleanup semantics.

That is the point.

---

## 21. Testing Strategy

### 21.1 Unit Tests

Test:

- activation spec validation,
- connection request info equality/matching,
- handle close behavior,
- cleanup reset behavior,
- exception mapping,
- retry decision logic,
- idempotency key extraction,
- config parsing.

### 21.2 Integration Tests

Test with container or realistic embedded/server environment:

- deployment of `.rar`,
- JNDI lookup/injection,
- outbound allocation,
- pool reuse,
- transaction enlistment,
- inbound endpoint activation,
- endpoint delivery,
- endpoint deactivation,
- redeploy,
- shutdown.

### 21.3 Failure Tests

Must include:

- EIS down at startup,
- EIS down during operation,
- connection reset,
- slow EIS,
- pool exhausted,
- endpoint exception,
- poison message,
- duplicate message,
- crash during transaction,
- credential rotation,
- server shutdown during in-flight delivery,
- redeploy while listener active.

A connector that only passes happy-path tests is not production-ready.

---

## 22. Anti-Patterns

### 22.1 Adapter Creates Its Own Unlimited Threads

Bad:

```java
new Thread(() -> pollForever()).start();
```

Why bad:

- bypasses container,
- unmanaged lifecycle,
- shutdown issues,
- no thread governance,
- classloader leaks.

Prefer container `WorkManager`.

### 22.2 ActivationSpec With Hidden Dangerous Defaults

Bad:

```text
maxConcurrency defaults to Integer.MAX_VALUE
retry forever
no dead-letter
pollInterval zero
```

Prefer explicit safe defaults and validation.

### 22.3 Fake XA

Bad:

```text
Adapter advertises XA but cannot recover after crash.
```

Prefer honest local transaction + idempotent reconciliation.

### 22.4 Leaky Connection Handle

Bad:

```java
LegacyPhysicalSession getPhysicalSession();
```

This exposes internals and breaks pooling semantics.

### 22.5 Ignoring Connection Matching

Bad:

```java
return connectionSet.iterator().next();
```

This can leak tenant/user state.

### 22.6 Swallowing Endpoint Exceptions

Bad:

```java
try {
    listener.onMessage(msg);
} catch (Exception ignored) {
}
ack(msg);
```

This causes data loss.

### 22.7 Infinite Poison Retry

Bad:

```text
same invalid message retried forever, blocking the whole queue
```

Use max attempts + dead-letter/quarantine.

---

## 23. How to Read JCA Production Incidents

When debugging JCA, ask in this order:

### 23.1 Direction

```text
Is this outbound or inbound?
```

Outbound problem:

```text
Application cannot get/use connection to EIS.
```

Inbound problem:

```text
EIS event/message not delivered correctly to application.
```

### 23.2 Boundary

```text
Which boundary failed?
```

- application ↔ connection factory,
- connection factory ↔ connection manager,
- container ↔ managed connection factory,
- managed connection ↔ EIS,
- EIS ↔ listener/poller,
- RA ↔ endpoint factory,
- endpoint ↔ business service,
- transaction manager ↔ EIS.

### 23.3 Lifecycle Phase

```text
Did failure occur at deploy, start, activation, allocation, delivery, transaction, cleanup, deactivation, or shutdown?
```

### 23.4 Contract Type

```text
Is this pooling, transaction, security, thread, classloading, or application contract?
```

This prevents random debugging.

---

## 24. Practical Design Heuristics

### 24.1 If You Build a Resource Adapter

Keep it boring.

- Make lifecycle explicit.
- Make concurrency bounded.
- Make transaction support honest.
- Make retry policy visible.
- Make error taxonomy stable.
- Make config validated.
- Make cleanup idempotent.
- Make shutdown testable.
- Make logs correlation-friendly.
- Make metrics first-class.

### 24.2 If You Consume a Vendor Resource Adapter

Do not blindly trust it.

Ask vendor/app server owner:

- Which Jakarta/Javax namespace is supported?
- Which app server versions are certified?
- Does it support outbound only or inbound too?
- What transaction modes are supported?
- Is XA recovery tested?
- How is pooling configured?
- How is credential rotation handled?
- What happens during EIS outage?
- Does inbound delivery support concurrency limits?
- How are poison messages handled?
- What metrics/logs are exposed?
- Is there a known classloading requirement?

### 24.3 If You Modernize Away From JCA

Preserve semantics first, replace technology second.

Before replacing JCA with a microservice client, identify:

- transaction semantics,
- pooling behavior,
- retry behavior,
- security mapping,
- inbound delivery guarantee,
- dead-letter behavior,
- operational controls,
- audit fields,
- failure/recovery procedure.

Otherwise, modernization silently weakens reliability.

---

## 25. Java 8–25 Compatibility Notes

### 25.1 Java Version

JCA/Jakarta Connectors is not about Java language feature. It is about container/spec compatibility.

Important dimensions:

| Dimension | Java EE era | Jakarta era |
|---|---|---|
| Package | `javax.resource.*` | `jakarta.resource.*` |
| Typical Java baseline | Java 8 | Java 11/17+ depending platform |
| Container | Java EE app server | Jakarta EE app server |
| Descriptor namespace | Java EE XML namespace | Jakarta EE XML namespace |
| Adapter binary compatibility | `javax` based | `jakarta` based |

A Java 25 runtime does not magically make an old `javax.resource` adapter Jakarta-compatible.

The container must support the relevant API and transformation/compatibility story.

### 25.2 Migration Checklist

- [ ] Identify adapter namespace: `javax` or `jakarta`.
- [ ] Identify target application server Jakarta EE version.
- [ ] Confirm Jakarta Connectors version supported.
- [ ] Confirm vendor RA version for target server.
- [ ] Confirm descriptor namespace/version.
- [ ] Confirm endpoint/MDB namespace.
- [ ] Confirm transaction manager support.
- [ ] Confirm classloading module placement.
- [ ] Retest activation/deactivation.
- [ ] Retest pool behavior.
- [ ] Retest XA/recovery if used.
- [ ] Retest shutdown/redeploy.

---

## 26. Mental Model Summary

JCA inbound/outbound architecture can be summarized as:

```text
Outbound:
Application wants to call EIS.
Container manages connection, transaction, security, pooling.
Resource adapter implements EIS-specific physical integration.
```

```text
Inbound:
EIS wants to call application.
Resource adapter receives/polls event.
Container creates endpoint and manages delivery semantics.
WorkManager controls execution.
ActivationSpec defines endpoint-specific subscription config.
```

The most important invariants:

1. Application should not manage physical EIS lifecycle directly.
2. Resource adapter should not bypass container lifecycle/thread/transaction semantics.
3. Connection matching must preserve security and tenant isolation.
4. Inbound delivery must assume duplicate is possible.
5. Activation/deactivation must be idempotent and leak-free.
6. XA support must be real or not claimed.
7. Backpressure must be explicit.
8. Observability must span application, container, adapter, and EIS.

---

## 27. What Top 1% Engineers Notice

Average engineer asks:

> “How do I configure the adapter?”

Strong engineer asks:

> “Where is the lifecycle boundary?”

Top 1% engineer asks:

> “What invariant is preserved across pooling, transaction, security, thread scheduling, delivery retry, shutdown, and migration?”

For JCA, the answer usually becomes:

```text
The container owns runtime governance.
The adapter owns protocol translation.
The application owns business semantics and idempotency.
The EIS owns external state.
The architecture must make these ownership boundaries explicit.
```

That is the core of production-grade connector architecture.

---

## 28. References

- Jakarta Connectors 2.1 Specification: https://jakarta.ee/specifications/connectors/2.1/jakarta-connectors-spec-2.1
- Jakarta Connectors 2.1 API Docs: https://jakarta.ee/specifications/connectors/2.1/apidocs/
- `jakarta.resource.spi` Package Docs: https://jakarta.ee/specifications/connectors/2.1/apidocs/jakarta.resource/jakarta/resource/spi/package-summary
- Jakarta EE Tutorial — Resource Adapters and Contracts: https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/resources/resources.html
- Jakarta EE 11 Release: https://jakarta.ee/release/11/
- Eclipse Jakarta Connectors Project: https://github.com/jakartaee/connectors

---

## 29. Penutup Part 32

Bagian ini membangun arsitektur inbound/outbound JCA secara struktural.

Kita sudah melihat bahwa JCA bukan hanya tentang “adapter”, tetapi tentang pembagian tanggung jawab:

```text
Application contract
System contract
EIS protocol contract
Runtime/container contract
```

Part berikutnya akan masuk ke area yang paling menentukan correctness enterprise integration:

> **Part 33 — JCA Transactions, Security & Reliability**

Di sana kita akan membahas XA vs local transaction, transaction inflow, credential propagation, recovery, poison messages, backpressure, duplicate handling, dan observability secara lebih dalam.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-031.md">⬅️ Part 31 — Jakarta Connectors / JCA Mental Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-json-xml-soap-connectors-enterprise-integration-part-033.md">Part 33 — JCA Transactions, Security & Reliability ➡️</a>
</div>
