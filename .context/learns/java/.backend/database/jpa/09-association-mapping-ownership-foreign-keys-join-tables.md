# Part 9 — Association Mapping: Ownership, Foreign Keys, Join Tables, and Graph Mutation

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> Bagian: `09-association-mapping-ownership-foreign-keys-join-tables.md`  
> Fokus: association mapping sebagai kontrak sinkronisasi antara object graph dan relational foreign key, bukan sekadar `@OneToMany`, `@ManyToOne`, `@JoinColumn`, atau `mappedBy`.

---

## 0. Posisi Materi dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

1. ORM adalah **state synchronization engine**.
2. Persistence context adalah **transactional object memory**.
3. Dirty checking mendeteksi perubahan state managed entity.
4. Flush mengubah perubahan state menjadi SQL action.
5. Dialect dan metadata memengaruhi SQL konkret yang dieksekusi.
6. Mapping field/column adalah kontrak antara domain object dan relational table.

Sekarang kita masuk ke salah satu bagian yang paling sering menyebabkan bug production: **association mapping**.

Association terlihat sederhana:

```java
order.getLines().add(line);
line.setOrder(order);
```

Tetapi secara relational, yang benar-benar berubah biasanya hanya ini:

```sql
update order_line
set order_id = ?
where id = ?;
```

Atau:

```sql
insert into order_line (order_id, product_id, quantity, id)
values (?, ?, ?, ?);
```

Atau, untuk join table:

```sql
insert into user_role (user_id, role_id)
values (?, ?);
```

Jadi association bukan “pointer Java ke object lain”. Association adalah **aturan bagaimana perubahan object graph diterjemahkan menjadi foreign key atau join row**.

Mental model inilah yang harus dikunci dulu.

---

## 1. Why This Matters

Association mapping adalah titik pertemuan antara dua model yang berbeda:

```text
Object model:
    Customer object memiliki List<Order>
    Order object memiliki Customer reference

Relational model:
    orders.customer_id menunjuk ke customers.id
```

Di object model, hubungan terasa natural:

```java
customer.getOrders().add(order);
```

Di relational model, tidak ada “collection column” di tabel `customer`. Yang ada adalah foreign key di tabel `orders`:

```text
customers
---------
id
name

orders
------
id
customer_id
order_number
```

Artinya, dalam banyak kasus, **sisi `many` adalah sisi yang secara fisik menyimpan foreign key**.

Ini menjelaskan kenapa bug berikut sering terjadi:

```java
Customer customer = em.find(Customer.class, id);
Order order = new Order();

customer.getOrders().add(order);
em.persist(order);
```

Developer berpikir relasi sudah tersimpan karena collection parent sudah diubah. Tetapi kalau mapping bidirectional memakai `mappedBy`, collection parent adalah **inverse side**, bukan owning side. Provider bisa saja tidak menganggap perubahan di collection itu sebagai perubahan relasi yang harus menulis FK.

Yang benar:

```java
order.setCustomer(customer); // owning side berubah
customer.getOrders().add(order); // object graph consistency
em.persist(order);
```

Dari sisi database, perubahan penting adalah `order.customer_id = customer.id`.

Association mapping penting karena memengaruhi:

- SQL insert/update/delete yang muncul saat flush.
- Constraint violation.
- Cascade behavior.
- Orphan removal.
- Fetch plan.
- N+1 dan cartesian explosion.
- Delete ordering.
- Aggregate boundary.
- Concurrency dan lost update.
- Audit trail dan history correctness.
- API boundary safety.

Top-tier engineer tidak hanya bertanya:

> “Annotation apa yang harus dipakai?”

Tetapi bertanya:

> “Di mana ownership relational-nya? Foreign key ada di tabel mana? Perubahan object graph mana yang akan menulis SQL? Apa invariant object graph yang harus selalu dijaga?”

---

## 2. Core Mental Model: Association Is Foreign Key Ownership

### 2.1 Association di Java vs Association di Database

Di Java:

```java
class Order {
    Customer customer;
}

class Customer {
    List<Order> orders;
}
```

Kedua arah bisa ada secara bersamaan. Object A bisa menyimpan reference ke B, dan B bisa menyimpan collection A.

Di relational database:

```text
orders.customer_id -> customers.id
```

Relasi fisik biasanya hanya disimpan di satu tempat: **foreign key column**.

Maka pertanyaan pertama untuk semua association adalah:

> Kolom atau row apa yang menyimpan relasi ini?

Bukan:

> Annotation mana yang lebih cantik?

### 2.2 Owning Side

Dalam JPA, **owning side** adalah sisi association yang perubahan state-nya dipakai provider untuk menentukan update relasi di database.

Rule praktis:

```text
Owning side = sisi yang punya @JoinColumn / foreign key control.
Inverse side = sisi yang memakai mappedBy.
```

Untuk bidirectional one-to-many/many-to-one:

```java
@Entity
class OrderLine {
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;
}

@Entity
class Order {
    @OneToMany(mappedBy = "order")
    private List<OrderLine> lines = new ArrayList<>();
}
```

Owning side:

```java
OrderLine.order
```

Inverse side:

```java
Order.lines
```

Karena FK ada di tabel `order_line`:

```text
order_line.order_id
```

### 2.3 `mappedBy` Bukan Nama Kolom

Ini kesalahan klasik.

```java
@OneToMany(mappedBy = "order")
private List<OrderLine> lines;
```

`mappedBy = "order"` menunjuk ke **nama field/property Java** di entity target, bukan nama kolom database.

Artinya:

```java
class OrderLine {
    private Order order; // inilah yang direferensikan mappedBy
}
```

Bukan:

```text
order_id
```

Kalau field di child bernama `parentOrder`, maka:

```java
@OneToMany(mappedBy = "parentOrder")
private List<OrderLine> lines;
```

### 2.4 Association Is Not Cascade

Association menjawab:

> Bagaimana dua entity dihubungkan?

Cascade menjawab:

> Kalau operasi dilakukan ke entity A, apakah operasi itu dipropagasikan ke entity B?

Contoh:

```java
@OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
private List<OrderLine> lines = new ArrayList<>();
```

Relasi ditentukan oleh:

```java
mappedBy = "order"
```

Lifecycle propagation ditentukan oleh:

```java
cascade = CascadeType.ALL
orphanRemoval = true
```

Mereka sering dipakai bersama, tetapi bukan hal yang sama.

### 2.5 Association Is Not Fetching

Association menjawab:

> Ada hubungan apa antara entity?

Fetching menjawab:

> Kapan dan bagaimana target association dimuat dari database?

Contoh:

```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "customer_id")
private Customer customer;
```

Relasi:

```text
orders.customer_id -> customers.id
```

Fetch strategy:

```text
Customer tidak langsung dimuat kecuali diperlukan / fetch plan menginstruksikan.
```

Jangan campur:

- ownership,
- cascade,
- fetching,
- optionality,
- database constraint.

Mereka saling berhubungan, tetapi masing-masing punya arti sendiri.

---

## 3. Association Type Overview

JPA menyediakan empat association utama:

| Association | Object Meaning | Common Relational Shape | Bias Praktis |
|---|---|---|---|
| `@ManyToOne` | Banyak child menunjuk satu parent | FK di child table | Paling natural dan sering menjadi owning side |
| `@OneToMany` | Satu parent punya banyak child | FK di child table atau join table | Sering inverse side dalam bidirectional mapping |
| `@OneToOne` | Satu entity berpasangan dengan satu entity lain | FK unik atau shared PK | Harus hati-hati dengan optionality dan lazy loading |
| `@ManyToMany` | Banyak A terhubung ke banyak B | Join table | Sering harus dipecah menjadi association entity |

Rule awal yang sangat berguna:

```text
Mulailah dari database shape.
Tentukan FK/join table.
Baru tentukan annotation.
```

Bukan sebaliknya.

---

## 4. `@ManyToOne`: The Relational Anchor

### 4.1 Kenapa `@ManyToOne` Sangat Penting

Dalam relational model, `many-to-one` adalah bentuk paling natural karena foreign key ada di sisi many.

Contoh:

```text
order_line.order_id -> orders.id
```

Entity:

```java
@Entity
@Table(name = "order_line")
public class OrderLine {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "order_line_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;

    @Column(name = "sku", nullable = false, length = 64)
    private String sku;

    @Column(name = "quantity", nullable = false)
    private int quantity;

    protected OrderLine() {
    }

    public OrderLine(String sku, int quantity) {
        if (sku == null || sku.isBlank()) {
            throw new IllegalArgumentException("sku must not be blank");
        }
        if (quantity <= 0) {
            throw new IllegalArgumentException("quantity must be positive");
        }
        this.sku = sku;
        this.quantity = quantity;
    }

    public Order getOrder() {
        return order;
    }

    void setOrder(Order order) {
        this.order = order;
    }
}
```

Generated SQL saat insert line baru:

```sql
insert into order_line (order_id, sku, quantity, id)
values (?, ?, ?, ?);
```

Yang menentukan `order_id` adalah:

```java
line.setOrder(order);
```

Bukan semata-mata:

```java
order.getLines().add(line);
```

### 4.2 `optional = false` vs `nullable = false`

Contoh:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "order_id", nullable = false)
private Order order;
```

`optional = false` adalah metadata association di level ORM/spec.

`nullable = false` adalah metadata column/DDL/schema generation.

Dalam desain production, jangan hanya mengandalkan annotation. Pastikan database constraint benar-benar ada:

```sql
alter table order_line
add constraint fk_order_line_order
foreign key (order_id) references orders(id);

alter table order_line
modify order_id not null;
```

Kenapa?

Karena ORM constraint hanya berlaku saat akses melalui ORM. Data bisa masuk lewat:

- migration script,
- integration job,
- data repair,
- batch process,
- native query,
- tool DBA,
- legacy system.

Database harus tetap menjadi sumber constraint terakhir.

### 4.3 Default Fetch Problem

JPA default untuk `@ManyToOne` adalah EAGER. Dalam engineering production, hampir selalu lebih aman eksplisit:

```java
@ManyToOne(fetch = FetchType.LAZY)
```

Kenapa?

Karena many-to-one tampak kecil, tetapi bisa menciptakan graph load tak terduga:

```text
OrderLine -> Order -> Customer -> Account -> Organization -> ...
```

EAGER bukan “load cepat”. EAGER adalah **global fetch obligation**.

Kalau satu query mengambil 500 `OrderLine`, EAGER customer/order chain bisa menciptakan banyak query tambahan atau join besar tergantung provider/fetch plan.

Design rule:

```text
Default mental model: semua association LAZY.
Fetch kebutuhan use case secara eksplisit melalui query/entity graph/projection.
```

### 4.4 Many-to-One Update

Jika child dipindah dari satu parent ke parent lain:

```java
line.setOrder(newOrder);
```

Flush dapat menghasilkan:

```sql
update order_line
set order_id = ?
where id = ?;
```

Tetapi jika bidirectional collection tidak disinkronkan:

```java
line.setOrder(newOrder);
oldOrder.getLines().contains(line); // mungkin masih true di memory
newOrder.getLines().contains(line); // mungkin false di memory
```

Database nanti benar, tetapi object graph dalam persistence context bisa tidak konsisten.

Itu sebabnya helper method penting.

---

## 5. Bidirectional Association Invariants

### 5.1 Masalah Utama Bidirectional Association

Bidirectional association memiliki dua reference Java untuk satu relasi database.

```java
order.lines contains line
line.order == order
```

Invariant yang harus dijaga:

```text
line ada di order.lines jika dan hanya jika line.order == order.
```

Jika invariant rusak, object graph bisa bohong terhadap database.

Contoh rusak:

```java
order.getLines().add(line);
// line.getOrder() masih null
```

Atau:

```java
line.setOrder(order);
// order.getLines() belum berisi line
```

Provider tidak otomatis selalu memperbaiki kedua sisi. Provider membaca owning side untuk SQL, sedangkan aplikasi bertanggung jawab menjaga graph consistency.

### 5.2 Helper Method yang Benar

Parent:

```java
@Entity
@Table(name = "orders")
public class Order {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "order_seq")
    private Long id;

    @OneToMany(
        mappedBy = "order",
        cascade = CascadeType.ALL,
        orphanRemoval = true
    )
    private List<OrderLine> lines = new ArrayList<>();

    protected Order() {
    }

    public List<OrderLine> getLines() {
        return Collections.unmodifiableList(lines);
    }

    public void addLine(OrderLine line) {
        Objects.requireNonNull(line, "line must not be null");

        if (line.getOrder() == this) {
            return;
        }

        if (line.getOrder() != null) {
            line.getOrder().removeLine(line);
        }

        lines.add(line);
        line.setOrder(this);
    }

    public void removeLine(OrderLine line) {
        Objects.requireNonNull(line, "line must not be null");

        if (lines.remove(line)) {
            line.setOrder(null);
        }
    }
}
```

Child:

```java
@Entity
@Table(name = "order_line")
public class OrderLine {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "order_line_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;

    protected OrderLine() {
    }

    Order getOrder() {
        return order;
    }

    void setOrder(Order order) {
        this.order = order;
    }
}
```

Catatan penting:

- Collection tidak diekspos mutable langsung.
- Mutasi relasi dilakukan lewat method domain.
- Owning side (`line.order`) selalu diset.
- Inverse side (`order.lines`) selalu disinkronkan.
- `setOrder` dibuat package-private agar tidak sembarang dipanggil dari luar aggregate.

### 5.3 Kenapa `getLines()` Sebaiknya Tidak Mengembalikan Mutable Collection Langsung

Anti-pattern:

```java
public List<OrderLine> getLines() {
    return lines;
}
```

Masalah:

```java
order.getLines().clear();
```

Aplikasi bisa menghapus seluruh child tanpa menjalankan invariant domain.

Lebih aman:

```java
public List<OrderLine> getLines() {
    return Collections.unmodifiableList(lines);
}
```

Lalu sediakan method eksplisit:

```java
public void addLine(OrderLine line)
public void removeLine(OrderLine line)
public void replaceLineQuantity(...)
```

Ini bukan hanya style OOP. Ini mencegah association drift.

---

## 6. `@OneToMany`: The Collection Side

### 6.1 Bidirectional One-to-Many yang Umum

Mapping paling umum:

```java
@Entity
class Order {
    @OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<OrderLine> lines = new ArrayList<>();
}

@Entity
class OrderLine {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "order_id", nullable = false)
    private Order order;
}
```

Relational shape:

```text
orders
------
id

order_line
----------
id
order_id not null references orders(id)
```

Object graph:

```text
Order 1 ---- * OrderLine
```

Ownership:

```text
OrderLine.order controls order_line.order_id.
Order.lines is inverse view.
```

### 6.2 Unidirectional One-to-Many with Join Table

Contoh:

```java
@Entity
class Order {
    @OneToMany(cascade = CascadeType.ALL)
    @JoinTable(
        name = "order_order_line",
        joinColumns = @JoinColumn(name = "order_id"),
        inverseJoinColumns = @JoinColumn(name = "line_id")
    )
    private List<OrderLine> lines = new ArrayList<>();
}
```

Relational shape:

```text
orders
------
id

order_line
----------
id

order_order_line
----------------
order_id
line_id
```

Ini kadang valid, tetapi sering tidak ideal untuk parent-child ownership. Kenapa?

Karena relasi parent-child yang sebenarnya bisa direpresentasikan lebih sederhana sebagai FK di child:

```text
order_line.order_id
```

Join table menambah:

- tabel ekstra,
- insert/delete join row ekstra,
- constraint ekstra,
- query join ekstra,
- kemungkinan duplicate relation row,
- kompleksitas delete.

Unidirectional one-to-many dengan join table cocok jika:

- child tidak boleh tahu parent di object model,
- relasi benar-benar terpisah dari child lifecycle,
- legacy schema sudah begitu,
- relasi perlu metadata di join row tetapi belum diangkat menjadi association entity.

Namun untuk aggregate parent-child, preferensi umum:

```text
Bidirectional OneToMany/ManyToOne dengan FK di child.
```

### 6.3 Unidirectional One-to-Many with JoinColumn

JPA juga memungkinkan:

```java
@Entity
class Order {
    @OneToMany(cascade = CascadeType.ALL, orphanRemoval = true)
    @JoinColumn(name = "order_id")
    private List<OrderLine> lines = new ArrayList<>();
}
```

Relational shape tetap:

```text
order_line.order_id -> orders.id
```

Tetapi child entity tidak punya field `order`.

Kelebihan:

- object model lebih sederhana dari sisi child,
- parent mengontrol collection.

Kekurangan:

- provider perlu mengelola FK child dari collection parent,
- bisa menghasilkan update ekstra tergantung insert ordering/provider,
- child tidak bisa navigate ke parent,
- query dari child ke parent kurang natural,
- ownership object berbeda dari lokasi FK relational.

Contoh SQL yang mungkin terjadi:

```sql
insert into order_line (sku, quantity, id)
values (?, ?, ?);

update order_line
set order_id = ?
where id = ?;
```

Mengapa update ekstra bisa muncul?

Karena child row dibuat dulu, lalu FK association diisi berdasarkan collection parent. Provider tertentu dan strategi ID tertentu dapat mengoptimalkan sebagian kasus, tetapi engineer tidak boleh mengasumsikan selalu optimal.

Design rule:

```text
Untuk parent-child yang intensif dimutasi, many-to-one owning side biasanya lebih jelas dan predictable.
```

---

## 7. `@OneToOne`: Unique Foreign Key or Shared Primary Key

### 7.1 One-to-One dengan Unique FK

Contoh:

```text
users
-----
id
username

user_profile
------------
id
user_id unique not null
bio
avatar_url
```

Mapping:

```java
@Entity
class UserProfile {

    @Id
    private Long id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false, unique = true)
    private User user;
}
```

Inverse side:

```java
@Entity
class User {

    @OneToOne(mappedBy = "user", fetch = FetchType.LAZY)
    private UserProfile profile;
}
```

Owning side adalah `UserProfile.user` karena `user_profile.user_id` menyimpan FK.

### 7.2 Shared Primary Key One-to-One

Relational shape:

```text
users
-----
id
username

user_profile
------------
user_id primary key references users(id)
bio
```

Mapping:

```java
@Entity
class UserProfile {

    @Id
    private Long id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @MapsId
    @JoinColumn(name = "user_id")
    private User user;
}
```

`@MapsId` berarti identity profile mengikuti identity user.

Ini cocok jika:

- profile tidak masuk akal tanpa user,
- lifecycle sangat melekat,
- one-to-one benar-benar composition,
- tidak perlu profile id terpisah.

### 7.3 One-to-One Lazy Loading Gotcha

One-to-one lazy sering lebih sulit daripada many-to-one lazy.

Kenapa?

Untuk `@ManyToOne`, FK ada di row pemilik:

```text
order.customer_id
```

Provider tahu apakah customer ada dari FK value.

Untuk inverse one-to-one:

```java
@OneToOne(mappedBy = "user", fetch = FetchType.LAZY)
private UserProfile profile;
```

FK ada di tabel `user_profile`, bukan di `users`. Saat load `User`, provider belum tentu tahu apakah profile ada tanpa query tambahan.

Provider bisa memakai:

- proxy,
- bytecode enhancement/weaving,
- secondary select,
- optional=false optimization,
- provider-specific lazy strategy.

Design rule:

```text
Jangan desain one-to-one dengan asumsi lazy selalu murah dan bekerja sama di semua provider.
Test SQL aktual.
```

### 7.4 Kapan One-to-One Sebaiknya Dihindari

One-to-one sering dipakai karena “tabel terlalu lebar”. Tetapi dalam banyak kasus, alternatif lebih baik:

1. **Secondary table** jika lifecycle dan identity sama.
2. **Embeddable** jika value object dan kolom tetap di tabel sama.
3. **Separate aggregate** jika lifecycle berbeda.
4. **JSON/document column** untuk extension data tertentu, jika database dan governance memungkinkan.

One-to-one buruk jika:

- hanya dipakai untuk menghindari null column tanpa alasan kuat,
- sering di-fetch bersama parent tetapi dipisah tabel,
- optional inverse lazy menyebabkan query tambahan,
- lifecycle sebenarnya berbeda tetapi dipaksa cascade all.

---

## 8. `@ManyToMany`: Usually a Smell in Enterprise Domains

### 8.1 Basic Many-to-Many

Contoh:

```java
@Entity
class User {
    @ManyToMany
    @JoinTable(
        name = "user_role",
        joinColumns = @JoinColumn(name = "user_id"),
        inverseJoinColumns = @JoinColumn(name = "role_id")
    )
    private Set<Role> roles = new HashSet<>();
}

@Entity
class Role {
    @ManyToMany(mappedBy = "roles")
    private Set<User> users = new HashSet<>();
}
```

Relational shape:

```text
users
-----
id

roles
-----
id

user_role
---------
user_id
role_id
```

For simple reference association, ini bisa diterima.

Contoh cocok:

- user-role lookup sederhana,
- product-tag sederhana,
- article-category sederhana.

### 8.2 Kenapa Many-to-Many Sering Salah

Dalam sistem enterprise, join row sering punya metadata:

```text
case_officer_assignment
-----------------------
case_id
officer_id
assigned_at
assigned_by
assignment_type
active_flag
reason
version
```

Kalau memakai `@ManyToMany`, metadata itu tidak punya tempat natural.

Solusi yang lebih benar: association entity.

```java
@Entity
@Table(name = "case_officer_assignment")
public class CaseOfficerAssignment {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "case_officer_assignment_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "case_id", nullable = false)
    private CaseRecord caseRecord;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "officer_id", nullable = false)
    private Officer officer;

    @Column(name = "assigned_at", nullable = false)
    private Instant assignedAt;

    @Column(name = "assigned_by", nullable = false, length = 100)
    private String assignedBy;

    @Enumerated(EnumType.STRING)
    @Column(name = "assignment_type", nullable = false, length = 50)
    private AssignmentType assignmentType;

    @Column(name = "active", nullable = false)
    private boolean active;

    @Version
    private long version;

    protected CaseOfficerAssignment() {
    }

    public CaseOfficerAssignment(
        CaseRecord caseRecord,
        Officer officer,
        String assignedBy,
        AssignmentType assignmentType
    ) {
        this.caseRecord = Objects.requireNonNull(caseRecord);
        this.officer = Objects.requireNonNull(officer);
        this.assignedBy = Objects.requireNonNull(assignedBy);
        this.assignmentType = Objects.requireNonNull(assignmentType);
        this.assignedAt = Instant.now();
        this.active = true;
    }
}
```

Sekarang join row menjadi first-class domain concept.

Manfaat:

- bisa punya audit metadata,
- bisa punya version,
- bisa soft-delete/deactivate,
- bisa enforce invariant,
- bisa query assignment history,
- bisa punya state transition,
- lebih defensible untuk regulatory system.

### 8.3 Cascade Remove pada Many-to-Many Adalah Bahaya

Anti-pattern:

```java
@ManyToMany(cascade = CascadeType.ALL)
private Set<Role> roles;
```

Jika user dihapus, apakah role juga harus dihapus?

Biasanya tidak. Role adalah shared reference.

Yang perlu dihapus adalah join row `user_role`, bukan row `roles`.

Design rule:

```text
Jangan cascade REMOVE dari many-to-many ke shared entity.
```

Lebih aman:

```java
@ManyToMany(cascade = { CascadeType.PERSIST, CascadeType.MERGE }) // kalau benar-benar perlu
private Set<Role> roles;
```

Bahkan sering kali tanpa cascade sama sekali.

---

## 9. Join Column vs Join Table

### 9.1 Join Column

Join column berarti association disimpan sebagai FK di salah satu table.

```java
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "customer_id")
private Customer customer;
```

Relational:

```text
orders.customer_id -> customers.id
```

Cocok untuk:

- many-to-one,
- one-to-one dengan FK,
- one-to-many FK child,
- parent-child containment.

### 9.2 Join Table

Join table berarti association disimpan dalam table terpisah.

```java
@ManyToMany
@JoinTable(
    name = "user_role",
    joinColumns = @JoinColumn(name = "user_id"),
    inverseJoinColumns = @JoinColumn(name = "role_id")
)
private Set<Role> roles;
```

Relational:

```text
user_role.user_id -> users.id
user_role.role_id -> roles.id
```

Cocok untuk:

- many-to-many sederhana,
- optional association yang tidak boleh mengubah tabel existing,
- legacy schema,
- association decoupling,
- relation row that may later become entity.

### 9.3 Decision Matrix

| Pertanyaan | Prefer Join Column | Prefer Join Table / Association Entity |
|---|---:|---:|
| Relasi parent-child jelas? | Ya | Jarang |
| Child dimiliki parent tunggal? | Ya | Jarang |
| Relasi punya metadata sendiri? | Tidak | Ya, association entity |
| Relasi many-to-many murni? | Tidak | Ya |
| Schema legacy tidak bisa diubah? | Tergantung | Sering |
| Perlu history assignment? | Tidak cukup | Association entity |
| Perlu soft delete relasi? | Bisa, tapi kurang natural | Association entity |
| Query sering dari child ke parent? | Ya | Tergantung |

Rule yang lebih tajam:

```text
Jika join row punya arti bisnis, jangan sembunyikan sebagai @ManyToMany.
Jadikan entity.
```

---

## 10. Optionality, Nullability, and Database Constraints

### 10.1 Optional Association

```java
@ManyToOne(fetch = FetchType.LAZY, optional = true)
@JoinColumn(name = "reviewer_id", nullable = true)
private User reviewer;
```

Artinya entity boleh tidak punya reviewer.

Relational:

```text
reviewer_id nullable
```

### 10.2 Mandatory Association

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "case_id", nullable = false)
private CaseRecord caseRecord;
```

Relational:

```text
case_id not null
```

### 10.3 Domain Optionality vs Database Optionality

Kadang domain optional berbeda berdasarkan state.

Contoh:

```text
Case reviewer boleh null saat DRAFT.
Case reviewer wajib ada saat UNDER_REVIEW.
```

Database `reviewer_id not null` tidak bisa mewakili aturan state-dependent itu.

Solusi:

- `reviewer_id` nullable di DB,
- domain method enforce transition invariant,
- validation sebelum state berubah,
- optional check di service/domain layer,
- database constraint tambahan jika memungkinkan melalui check/trigger, tapi hati-hati kompleksitas.

Contoh:

```java
public void submitForReview(User reviewer) {
    if (this.status != CaseStatus.DRAFT) {
        throw new IllegalStateException("Only draft case can be submitted");
    }
    this.reviewer = Objects.requireNonNull(reviewer, "reviewer is required");
    this.status = CaseStatus.UNDER_REVIEW;
}
```

Design rule:

```text
Database nullability cocok untuk invariant absolut.
State-dependent invariant harus dimodelkan eksplisit dalam domain transition.
```

---

## 11. Graph Mutation Semantics

### 11.1 Mutation Ada Dua Level

Association mutation terjadi di dua level:

1. **Object graph mutation**
2. **Relational FK/join row mutation**

Contoh object graph:

```java
order.addLine(line);
```

Relational mutation:

```sql
insert into order_line (..., order_id, ...)
values (..., ?, ...);
```

Atau:

```sql
update order_line
set order_id = ?
where id = ?;
```

### 11.2 Move Child Between Parents

Contoh:

```java
oldOrder.removeLine(line);
newOrder.addLine(line);
```

Jika orphanRemoval aktif, hati-hati.

```java
@OneToMany(mappedBy = "order", orphanRemoval = true)
private List<OrderLine> lines;
```

Kalau child dilepas dari old parent, provider dapat menganggap child sebagai orphan yang harus dihapus.

Dalam satu persistence context, sequence operation dan provider behavior penting.

Safer method:

```java
public void moveLineTo(OrderLine line, Order target) {
    if (!this.lines.contains(line)) {
        throw new IllegalArgumentException("line does not belong to this order");
    }
    this.lines.remove(line);
    target.lines.add(line);
    line.setOrder(target);
}
```

Tetapi secara domain, pertanyaan lebih penting:

> Apakah order line boleh dipindah antar order?

Dalam banyak domain, jawabannya tidak. Lebih benar delete/recreate atau reversal.

### 11.3 Replace Collection Anti-Pattern

Anti-pattern:

```java
order.setLines(requestLines);
```

Bahaya:

- provider melihat collection lama diganti,
- orphan removal bisa menghapus child lama,
- child baru mungkin detached/transient campur,
- FK update/delete storm,
- audit trail sulit dimaknai,
- optimistic locking behavior tidak jelas.

Lebih baik command-based mutation:

```java
order.addLine(...);
order.changeQuantity(lineId, quantity);
order.removeLine(lineId);
```

Atau reconciliation explicit:

```java
public void replaceLines(List<LineCommand> desiredLines) {
    // explicit diff by stable business key
    // update existing
    // add missing
    // remove obsolete
}
```

Design rule:

```text
Jangan treat child collection sebagai raw setter.
Treat sebagai controlled aggregate mutation surface.
```

---

## 12. SQL Consequences of Association Choices

### 12.1 Bidirectional Many-to-One/One-to-Many

Mapping:

```java
class OrderLine {
    @ManyToOne
    @JoinColumn(name = "order_id")
    private Order order;
}

class Order {
    @OneToMany(mappedBy = "order")
    private List<OrderLine> lines;
}
```

Insert new order with two lines:

```sql
insert into orders (id, ...) values (?, ...);
insert into order_line (id, order_id, sku, quantity) values (?, ?, ?, ?);
insert into order_line (id, order_id, sku, quantity) values (?, ?, ?, ?);
```

Predictable.

### 12.2 Unidirectional One-to-Many with JoinColumn

Mapping:

```java
class Order {
    @OneToMany
    @JoinColumn(name = "order_id")
    private List<OrderLine> lines;
}
```

Possible SQL:

```sql
insert into orders (id, ...) values (?, ...);
insert into order_line (id, sku, quantity) values (?, ?, ?);
insert into order_line (id, sku, quantity) values (?, ?, ?);
update order_line set order_id = ? where id = ?;
update order_line set order_id = ? where id = ?;
```

Tidak selalu terjadi di semua kondisi/provider, tetapi ini risk pattern yang harus diketahui.

### 12.3 Many-to-Many

Add role to user:

```java
user.getRoles().add(role);
```

SQL:

```sql
insert into user_role (user_id, role_id) values (?, ?);
```

Remove role:

```sql
delete from user_role
where user_id = ? and role_id = ?;
```

Jika collection berupa `List` tanpa index/order semantics yang tepat, provider bisa kurang efisien dibanding `Set` untuk join membership.

### 12.4 Delete Parent with Children

Jika ORM cascade remove:

```java
em.remove(order);
```

Possible SQL:

```sql
delete from order_line where id = ?;
delete from order_line where id = ?;
delete from orders where id = ?;
```

Jika DB cascade:

```sql
delete from orders where id = ?;
-- database deletes children via ON DELETE CASCADE
```

ORM cascade dan DB cascade berbeda. Jangan campur tanpa memahami efek pada persistence context dan cache.

---

## 13. Hibernate Behavior Notes

### 13.1 Owning Side Dominance

Hibernate mengikuti konsep owning side JPA. Dalam bidirectional association, perubahan di inverse side saja tidak cukup sebagai sumber kebenaran relasi.

Contoh:

```java
order.getLines().add(line); // inverse side only
```

Jika `line.order` tidak diset, FK bisa tetap null atau tidak sesuai ekspektasi.

### 13.2 Collection Wrapper

Hibernate mengganti collection entity dengan persistent collection wrapper saat entity managed.

Contoh field:

```java
private List<OrderLine> lines = new ArrayList<>();
```

Saat managed, Hibernate bisa memakai wrapper internal untuk:

- lazy initialization,
- snapshot collection,
- dirty detection,
- orphan detection,
- queued operations.

Karena itu, mengganti instance collection bisa berbahaya:

```java
this.lines = new ArrayList<>(newLines); // risky for managed entity
```

Lebih aman mutate collection existing via helper method.

### 13.3 Bags, Sets, and Duplicate Semantics

Hibernate membedakan collection semantics seperti bag/list/set. Detail koleksi akan dibahas pada Part 10, tetapi association design sudah harus sadar bahwa:

- `List` tanpa `@OrderColumn` sering seperti bag,
- bag boleh duplicate,
- multiple bag fetch bisa bermasalah,
- `Set` bergantung pada `equals/hashCode`,
- entity equality yang salah dapat merusak membership.

### 13.4 Cascading and Transient Object

Contoh:

```java
Order order = em.find(Order.class, orderId);
OrderLine line = new OrderLine("SKU-1", 2);
order.addLine(line);
```

Jika `Order.lines` punya cascade persist/all, line akan dipersist saat flush.

Tanpa cascade:

```text
TransientObjectException / unsaved transient instance risk
```

Namun jangan menambahkan cascade sebagai obat universal. Cascade harus mencerminkan lifecycle ownership.

### 13.5 Hibernate-Specific Extensions

Hibernate punya extension seperti:

- `@BatchSize`,
- `@Fetch`,
- `@Where`/newer alternatives depending version,
- filters,
- `@NotFound`,
- `@OnDelete`,
- natural id support,
- custom collection/fetch behavior.

Gunakan extension saat memberi value nyata, tetapi catat bahwa ini mengurangi portability.

---

## 14. EclipseLink Behavior Notes

### 14.1 UnitOfWork and Relationship Change Tracking

EclipseLink memakai UnitOfWork concept untuk melacak perubahan object graph. Relationship change tracking dapat dipengaruhi oleh weaving dan descriptor metadata.

Hal yang harus diperhatikan:

- weaving dapat meningkatkan lazy loading/change tracking,
- shared cache dapat memengaruhi stale relationship jika invalidation salah,
- descriptor customization bisa mengubah mapping behavior,
- batch reading/join fetching punya karakteristik berbeda dari Hibernate.

### 14.2 Weaving and Lazy Associations

EclipseLink sangat bergantung pada weaving untuk beberapa behavior advanced, termasuk lazy loading pada relationship tertentu.

Jika weaving tidak aktif di runtime/test, behavior bisa berbeda:

```text
Development: lazy works.
Test: lazy unexpectedly eager or broken.
Production: classloader config changes behavior.
```

Design rule:

```text
Untuk EclipseLink, testing environment harus merepresentasikan weaving mode production.
```

### 14.3 Shared Cache and Relationship Staleness

EclipseLink shared cache powerful, tetapi association correctness harus dipikirkan.

Jika satu node/update path mengubah relationship dan cache invalidation tidak sesuai, node lain bisa melihat object graph stale.

Contoh risiko:

```text
Case assignment dipindah dari officer A ke officer B.
Cache officer A masih menunjukkan assignment lama.
```

Solusi bisa melibatkan:

- cache coordination,
- cache isolation per entity,
- explicit refresh,
- disabling shared cache for volatile relationship,
- versioning,
- query strategy.

---

## 15. Java 8–25 Compatibility Notes

### 15.1 Java 8 Legacy Stack

Umum:

```text
Java 8
javax.persistence.*
JPA 2.1/2.2
Hibernate 5.x
EclipseLink 2.x
Spring Boot 2.x or Java EE/Jakarta EE older stack
```

Karakteristik:

- namespace masih `javax.persistence`,
- Java Time support tergantung JPA 2.2/provider/version,
- Hibernate 5 type system berbeda dari Hibernate 6/7,
- banyak project legacy masih memakai lazy proxy assumptions lama,
- migration ke Jakarta bukan sekadar package rename jika provider/framework berubah.

### 15.2 Java 11/17/21/25 Modern Stack

Umum:

```text
Java 17/21/25
jakarta.persistence.*
Jakarta Persistence 3.x
Hibernate 6/7
EclipseLink 4.x
Spring Boot 3.x / Jakarta EE 10/11 aligned runtime
```

Karakteristik:

- namespace `jakarta.persistence`,
- Hibernate SQL/query engine berubah besar sejak 6,
- dialect class dan type system banyak berubah,
- bytecode enhancement/build plugin perlu disesuaikan,
- module path/classpath issue lebih terlihat,
- records cocok untuk DTO projection, bukan entity mutable lifecycle secara umum,
- virtual threads tidak mengubah fakta bahwa ORM/JDBC access tetap transaction-bound dan connection-bound.

### 15.3 Entity Design Across Java Versions

Entity masih sebaiknya:

- non-final class,
- punya protected no-arg constructor,
- field mutable untuk provider,
- association mutable melalui method domain,
- tidak berupa Java record,
- tidak bergantung pada final field untuk persistent state.

DTO/projection boleh memakai:

- records,
- immutable classes,
- sealed hierarchy untuk API model jika sesuai.

Jangan campur entity dan API record hanya karena Java modern mendukung record.

---

## 16. Design Patterns for Association Mapping

### 16.1 Parent-Child Aggregate Pattern

Gunakan saat child tidak bermakna tanpa parent.

Contoh:

```text
Order -> OrderLine
CaseRecord -> CaseNote
Application -> ApplicationAttachmentMetadata
```

Mapping:

```java
@OneToMany(mappedBy = "parent", cascade = CascadeType.ALL, orphanRemoval = true)
private List<Child> children = new ArrayList<>();

@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "parent_id", nullable = false)
private Parent parent;
```

Rules:

- Parent punya helper method.
- Child setter parent tidak public bebas.
- Cascade all bisa valid jika lifecycle benar-benar owned.
- Orphan removal valid jika removal dari collection berarti delete child.
- FK not null.

### 16.2 Reference Association Pattern

Gunakan saat entity hanya mereferensikan lookup/shared aggregate.

Contoh:

```text
CaseRecord -> Officer
Application -> ApplicantProfile
Order -> Customer
```

Mapping:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "officer_id", nullable = false)
private Officer officer;
```

Rules:

- Biasanya tanpa cascade remove.
- Jangan lifecycle-manage target dari source.
- Validate target existence/permission di service boundary.
- Fetch target sesuai use case.

### 16.3 Association Entity Pattern

Gunakan saat relationship punya metadata.

Contoh:

```text
CaseOfficerAssignment
UserRoleAssignment
ApplicationDocumentLink
InspectionFindingRegulationMapping
```

Mapping:

```java
@Entity
class Assignment {
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private CaseRecord caseRecord;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    private Officer officer;

    private Instant assignedAt;
    private String assignedBy;
    private boolean active;
}
```

Rules:

- Jangan pakai `@ManyToMany` jika relation punya attributes.
- Add unique constraint sesuai invariant.
- Version association entity jika assignment bisa diedit.
- Audit association entity secara eksplisit.

### 16.4 Read-Only Reference Pattern

Gunakan untuk reference table/master data.

Contoh:

```text
Country
CaseType
ApplicationStatusDimension
RegulationCode
```

Mapping:

```java
@ManyToOne(fetch = FetchType.LAZY, optional = false)
@JoinColumn(name = "case_type_id", nullable = false, updatable = false)
private CaseType caseType;
```

Atau entity target dianggap immutable secara provider-specific.

Rules:

- Jangan cascade.
- Cache bisa dipertimbangkan.
- Treat as stable reference.
- Update melalui controlled admin/migration path.

---

## 17. Regulatory / Case Management Example

Bayangkan domain enforcement lifecycle:

```text
CaseRecord
 ├── CaseStatusHistory
 ├── CaseAssignment
 ├── CaseDocumentLink
 ├── ComplianceFinding
 ├── Correspondence
 └── AuditTrail
```

Naive model:

```java
@Entity
class CaseRecord {
    @ManyToMany
    private Set<Officer> officers;

    @OneToMany
    private List<Document> documents;

    @OneToMany
    private List<AuditTrail> auditTrails;
}
```

Masalah:

- officer assignment tidak punya assignedAt/assignedBy/reason,
- document link tidak punya document type/source/classification,
- audit trail bisa menjadi huge collection dan tidak boleh dimuat sebagai child biasa,
- many-to-many menyembunyikan lifecycle penting,
- collection besar bisa menyebabkan memory dan fetch issue,
- regulatory defensibility lemah.

Lebih baik:

```text
CaseRecord
 ├── CaseAssignment        -> association entity to Officer
 ├── CaseDocumentLink      -> association entity to Document
 ├── CaseStatusHistory     -> append-only history
 ├── ComplianceFinding     -> owned child or separate aggregate depending lifecycle
 └── AuditTrail            -> separate append-only model, queried independently
```

Mapping sketch:

```java
@Entity
@Table(name = "case_record")
public class CaseRecord {

    @Id
    private Long id;

    @Version
    private long version;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 50)
    private CaseStatus status;

    @OneToMany(mappedBy = "caseRecord", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<CaseAssignment> assignments = new ArrayList<>();

    protected CaseRecord() {
    }

    public void assignTo(Officer officer, User actor, String reason) {
        requireStatusAllowsAssignment();
        deactivateCurrentPrimaryAssignment(actor);
        CaseAssignment assignment = CaseAssignment.primary(this, officer, actor, reason);
        assignments.add(assignment);
    }
}
```

Association entity:

```java
@Entity
@Table(
    name = "case_assignment",
    indexes = {
        @Index(name = "idx_case_assignment_case", columnList = "case_id"),
        @Index(name = "idx_case_assignment_officer", columnList = "officer_id")
    }
)
public class CaseAssignment {

    @Id
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "case_id", nullable = false)
    private CaseRecord caseRecord;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "officer_id", nullable = false)
    private Officer officer;

    @Column(name = "assigned_at", nullable = false)
    private Instant assignedAt;

    @Column(name = "assigned_by", nullable = false, length = 100)
    private String assignedBy;

    @Column(name = "reason", length = 1000)
    private String reason;

    @Column(name = "active", nullable = false)
    private boolean active;

    protected CaseAssignment() {
    }

    static CaseAssignment primary(CaseRecord caseRecord, Officer officer, User actor, String reason) {
        CaseAssignment assignment = new CaseAssignment();
        assignment.caseRecord = Objects.requireNonNull(caseRecord);
        assignment.officer = Objects.requireNonNull(officer);
        assignment.assignedBy = actor.username();
        assignment.assignedAt = Instant.now();
        assignment.reason = reason;
        assignment.active = true;
        return assignment;
    }

    public void deactivate(User actor) {
        this.active = false;
        // optionally store deactivatedBy/deactivatedAt
    }
}
```

Design insight:

```text
In regulatory systems, relationship often is not just relationship.
It is an auditable business fact.
```

Therefore association entity is often superior to direct collection association.

---

## 18. Failure Modes and Root Causes

### 18.1 Wrong Side Update

Symptom:

```text
Child appears in parent collection in memory, but DB FK is null or unchanged.
```

Cause:

```java
parent.getChildren().add(child); // inverse side only
```

Fix:

```java
child.setParent(parent);         // owning side
parent.getChildren().add(child); // graph consistency
```

Better:

```java
parent.addChild(child);
```

### 18.2 Duplicate Join Rows

Symptom:

```text
Duplicate rows in user_role or join table.
```

Cause:

- missing unique constraint,
- collection type allows duplicates,
- broken equality,
- repeated add operation,
- detached merge duplicate.

Fix:

```sql
alter table user_role
add constraint uk_user_role unique (user_id, role_id);
```

And use controlled add:

```java
public void addRole(Role role) {
    roles.add(Objects.requireNonNull(role));
}
```

### 18.3 Orphan Leak

Symptom:

```text
Removed child disappears from parent collection but remains in DB.
```

Cause:

```java
@OneToMany(mappedBy = "parent")
private List<Child> children;
```

No orphanRemoval and no explicit remove.

Fix if lifecycle owned:

```java
@OneToMany(mappedBy = "parent", cascade = CascadeType.ALL, orphanRemoval = true)
private List<Child> children;
```

But only if removal from parent truly means delete child.

### 18.4 Accidental Delete of Shared Entity

Symptom:

```text
Deleting one parent deletes shared reference data used elsewhere.
```

Cause:

```java
@ManyToMany(cascade = CascadeType.ALL)
private Set<Role> roles;
```

Fix:

- remove cascade remove,
- cascade only where lifecycle ownership is true,
- use DB FK restrict for shared reference.

### 18.5 FK Update Storm

Symptom:

```text
Saving parent triggers many update child set parent_id = ? statements.
```

Cause:

- unidirectional one-to-many with join column,
- replacing collection,
- list order column update,
- provider cannot set FK during insert due to mapping strategy.

Fix:

- use many-to-one owning side,
- mutate collection incrementally,
- avoid raw collection replacement,
- review generated SQL.

### 18.6 Cartesian Explosion

Symptom:

```text
Query returns huge row count because multiple collections are join fetched.
```

Cause:

```jpql
select c
from CaseRecord c
join fetch c.assignments
join fetch c.documents
join fetch c.findings
```

If each case has:

```text
5 assignments x 10 documents x 8 findings = 400 rows per case
```

Fix:

- fetch one collection at a time,
- batch fetch,
- DTO projection,
- separate query per collection,
- read model.

### 18.7 LazyInitializationException / Detached Graph Trap

Symptom:

```text
Accessing parent.children outside transaction fails.
```

Cause:

- returning entity to API layer,
- lazy collection uninitialized,
- transaction closed.

Fix:

- DTO projection inside transaction,
- explicit fetch plan,
- application service boundary,
- avoid exposing entities as API response.

### 18.8 Stale Bidirectional Graph

Symptom:

```java
line.getOrder() == newOrder
oldOrder.getLines().contains(line) == true
```

Cause:

- updated owning side only,
- inverse side not synchronized.

Fix:

- helper methods,
- controlled mutation,
- avoid public setters for both sides.

---

## 19. Anti-Patterns

### 19.1 Annotation-First Design

Bad:

```text
“I need one-to-many, so I add @OneToMany.”
```

Better:

```text
“What table stores the relationship? Is it FK or join row? Who owns lifecycle? Does relationship have metadata?”
```

### 19.2 `CascadeType.ALL` Everywhere

Bad:

```java
@ManyToOne(cascade = CascadeType.ALL)
private Customer customer;
```

If order is deleted, should customer be deleted? Almost certainly no.

### 19.3 Public Mutable Collection Getter

Bad:

```java
public List<Line> getLines() {
    return lines;
}
```

Better:

```java
public List<Line> getLines() {
    return Collections.unmodifiableList(lines);
}
```

And explicit mutation methods.

### 19.4 Using Many-to-Many for Business Relationship

Bad:

```java
@ManyToMany
private Set<Officer> assignedOfficers;
```

If assignment needs `assignedAt`, `assignedBy`, `reason`, `active`, it is not simple many-to-many.

### 19.5 Mapping Huge Audit Trails as Normal Child Collection

Bad:

```java
@OneToMany(mappedBy = "caseRecord")
private List<AuditTrail> auditTrails;
```

If a case can have thousands/millions of audit entries across lifecycle, this collection is dangerous.

Better:

- query audit trail independently,
- paginate,
- use append-only table,
- avoid loading through parent aggregate.

### 19.6 Entity Graph as API Graph

Bad:

```java
return caseRepository.findById(id).orElseThrow();
```

Then JSON serialization walks associations.

Better:

```java
return caseQueryService.getCaseDetail(id);
```

where result is DTO/projection with explicit fetch plan.

---

## 20. Diagnostic Checklist

When debugging association problems, ask in this order:

### 20.1 Mapping Shape

1. What is the relational shape?
2. Is association stored as FK or join table?
3. Which table has FK?
4. Which entity field is owning side?
5. Is `mappedBy` pointing to Java field name, not column?

### 20.2 Object Graph

1. Are both sides of bidirectional association synchronized?
2. Are helper methods used?
3. Are public setters/collection getters bypassing invariants?
4. Is collection replaced wholesale?
5. Are detached entities being merged?

### 20.3 Lifecycle

1. Is cascade actually needed?
2. Is target shared or owned?
3. Is orphan removal semantically correct?
4. Could remove operation delete shared data?
5. Is DB `ON DELETE CASCADE` also active?

### 20.4 SQL

1. What SQL is generated on insert?
2. Are there unexpected update statements?
3. Are join table rows inserted/deleted as expected?
4. Are FK constraints violated before commit?
5. Is flush happening earlier than expected?

### 20.5 Performance

1. Is association lazy or eager?
2. Is query causing N+1?
3. Is join fetch causing cartesian explosion?
4. Is collection huge?
5. Is child collection initialized accidentally by logging/serialization?

### 20.6 Consistency

1. Is optimistic locking on aggregate root enough?
2. Does child/association entity need its own version?
3. Are bulk operations bypassing persistence context?
4. Is second-level/shared cache involved?
5. Could tenant/security filters be missing on association query?

---

## 21. Practice Scenarios

### Scenario 1 — Parent Collection Updated but FK Null

You have:

```java
parent.getChildren().add(child);
em.persist(child);
```

But `child.parent_id` is null.

Questions:

1. Which side is owning?
2. Does child have `@ManyToOne`?
3. Is parent collection `mappedBy`?
4. Should helper method set both sides?

Expected fix:

```java
parent.addChild(child);
```

where:

```java
children.add(child);
child.setParent(this);
```

### Scenario 2 — Deleting User Deletes Role

You find:

```java
@ManyToMany(cascade = CascadeType.ALL)
private Set<Role> roles;
```

Questions:

1. Is Role shared?
2. Should deleting User delete Role?
3. Should cascade remove exist?
4. Is join table row deletion enough?

Expected fix:

- remove `CascadeType.REMOVE`/`ALL`,
- avoid cascade or use limited cascade,
- ensure join table FK constraints.

### Scenario 3 — Case Assignment Needs History

Current mapping:

```java
@ManyToMany
private Set<Officer> assignedOfficers;
```

New requirement:

```text
Need assignedAt, assignedBy, assignmentReason, active/inactive, previous assignments.
```

Expected redesign:

```text
CaseAssignment entity
```

with two many-to-one associations and metadata fields.

### Scenario 4 — Endpoint Slow After Adding Join Fetch

Query:

```jpql
select c
from CaseRecord c
join fetch c.assignments
join fetch c.documents
join fetch c.findings
where c.id = :id
```

Problem:

```text
Rows explode multiplicatively.
```

Expected fix:

- fetch root + one collection,
- load other collections separately,
- DTO projection,
- batch fetching,
- read model.

### Scenario 5 — Child Removed from Collection but Still in DB

Mapping:

```java
@OneToMany(mappedBy = "order", cascade = CascadeType.ALL)
private List<OrderLine> lines;
```

Operation:

```java
order.getLines().remove(line);
```

Problem:

```text
Line remains in DB or FK is nulled.
```

Expected analysis:

- Is orphanRemoval enabled?
- Is child FK nullable?
- Was owning side updated?
- Does removal mean delete or detach?

Expected fix if owned child:

```java
@OneToMany(mappedBy = "order", cascade = CascadeType.ALL, orphanRemoval = true)
```

And helper:

```java
removeLine(line) {
    lines.remove(line);
    line.setOrder(null);
}
```

---

## 22. Design Rules Summary

1. **Start from relational shape.** Determine FK/join table before annotation.
2. **Owning side controls database relationship.** Inverse side is object navigation convenience.
3. **`mappedBy` points to Java field/property name, not column name.**
4. **Bidirectional association needs invariant maintenance.** Use helper methods.
5. **Do not expose mutable collections freely.** Protect aggregate mutation surface.
6. **`@ManyToOne` is usually the relational anchor.** Prefer it for FK ownership.
7. **Use `@ManyToMany` only for simple relationship without metadata.** Otherwise create association entity.
8. **Cascade must follow lifecycle ownership.** Never add `CascadeType.ALL` blindly.
9. **Orphan removal means removal from collection deletes child.** Use only when semantically true.
10. **Join table is not free.** It adds SQL, constraints, and failure modes.
11. **One-to-one lazy loading must be tested per provider.** Especially inverse optional one-to-one.
12. **Generated SQL is the truth.** Always verify insert/update/delete behavior.
13. **Large child collections are dangerous.** Query separately or design read models.
14. **Association entity is often the right answer in enterprise/regulatory systems.** Relationship often carries business facts.
15. **Do not let API serialization walk entity associations.** Use DTO/projection/fetch plans.

---

## 23. Key Takeaways

Association mapping is not about memorizing four annotations. It is about modeling how object graph relationships become database constraints and SQL mutations.

The central questions are:

```text
Where is the relationship stored?
Who owns the foreign key or join row?
Is the target owned or shared?
Does the relationship have metadata?
What SQL should happen when the graph changes?
What invariant must stay true in memory before flush?
```

If you can answer those questions, annotations become implementation details.

If you cannot answer those questions, annotations become traps.

For high-quality enterprise systems, especially case management, enforcement, approval, compliance, and regulatory workflows, association design must be defensible:

- explicit ownership,
- explicit lifecycle,
- explicit history,
- explicit mutation methods,
- explicit fetch plan,
- explicit failure model.

That is the difference between “using JPA” and engineering a reliable persistence model.

---

## 24. References and Further Reading

- Jakarta Persistence 3.2 Specification — relationship mappings, owning side, bidirectional associations, join columns, join tables.
- Jakarta Persistence 3.2 API docs — `@OneToMany`, `@ManyToOne`, `@OneToOne`, `@ManyToMany`, `@JoinColumn`, `@JoinTable`.
- Hibernate ORM User Guide — associations, bidirectional association ownership, collection semantics, cascading, fetching.
- Hibernate ORM 7 Introduction/User Guide — modern Hibernate behavior and association examples.
- EclipseLink Documentation — relationship mappings, one-to-many mapping, UnitOfWork, weaving, shared cache behavior.

---

## 25. What Comes Next

Next part:

```text
10-collection-mapping-bags-lists-sets-maps-ordering-hidden-costs.md
```

Part 10 will go deeper into collection semantics:

- bag vs list vs set,
- `@OrderBy` vs `@OrderColumn`,
- `Map` mapping,
- element collection,
- duplicate semantics,
- collection dirty checking,
- delete/reinsert behavior,
- multiple bag fetch,
- huge collection failure modes.
