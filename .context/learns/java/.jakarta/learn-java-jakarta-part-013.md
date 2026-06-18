# learn-java-jakarta-part-013.md

# Bagian 13 — Jakarta Data: Repository Abstraction Standar

> Target pembaca: Java engineer yang sudah memahami JPA/Jakarta Persistence dan ingin memahami **Jakarta Data 1.0** sebagai standard repository abstraction baru di Jakarta EE 11.
>
> Fokus bagian ini: Jakarta Data bukan “JPA versi singkat”, bukan “Spring Data clone mentah”, dan bukan pengganti domain modeling. Jakarta Data adalah **standard programming model** untuk data access berbasis repository interface, dengan tujuan menyederhanakan common database operations, sambil tetap mempertahankan kekuatan dan batasan underlying datastore.

---

## Daftar Isi

1. [Orientasi: Kenapa Jakarta Data Muncul?](#1-orientasi-kenapa-jakarta-data-muncul)
2. [Mental Model: Repository Abstraction di Atas Persistence Provider](#2-mental-model-repository-abstraction-di-atas-persistence-provider)
3. [Jakarta Data 1.0 dalam Jakarta EE 11](#3-jakarta-data-10-dalam-jakarta-ee-11)
4. [Apa yang Jakarta Data Selesaikan](#4-apa-yang-jakarta-data-selesaikan)
5. [Apa yang Jakarta Data Tidak Coba Selesaikan](#5-apa-yang-jakarta-data-tidak-coba-selesaikan)
6. [Jakarta Data vs Jakarta Persistence / JPA](#6-jakarta-data-vs-jakarta-persistence--jpa)
7. [Jakarta Data vs Spring Data](#7-jakarta-data-vs-spring-data)
8. [Jakarta Data vs Jakarta NoSQL](#8-jakarta-data-vs-jakarta-nosql)
9. [Dependency, Provider, dan Runtime](#9-dependency-provider-dan-runtime)
10. [Peta API Jakarta Data](#10-peta-api-jakarta-data)
11. [`@Repository`: Interface sebagai Contract](#11-repository-interface-sebagai-contract)
12. [Built-in Repository Supertypes: `DataRepository`, `BasicRepository`, `CrudRepository`](#12-built-in-repository-supertypes-datarepository-basicrepository-crudrepository)
13. [Entity Classes dalam Jakarta Data](#13-entity-classes-dalam-jakarta-data)
14. [Identifier, Entity Type, dan Primary Entity Type](#14-identifier-entity-type-dan-primary-entity-type)
15. [Lifecycle Operations: Insert, Update, Save, Delete](#15-lifecycle-operations-insert-update-save-delete)
16. [Query Model: Tiga Cara Menulis Query](#16-query-model-tiga-cara-menulis-query)
17. [Parameter-Based Automatic Query Methods: `@Find` dan `@Delete`](#17-parameter-based-automatic-query-methods-find-dan-delete)
18. [`@Query`: JDQL, JPQL, dan Provider-Specific Query](#18-query-jdql-jpql-dan-provider-specific-query)
19. [Query by Method Name: Useful, Tapi Harus Hati-Hati](#19-query-by-method-name-useful-tapi-harus-hati-hati)
20. [Special Parameters: `Limit`, `Order`, `Sort`, `PageRequest`](#20-special-parameters-limit-order-sort-pagerequest)
21. [Pagination: Offset vs Cursor](#21-pagination-offset-vs-cursor)
22. [Return Types: Entity, Optional, List, Page, Stream](#22-return-types-entity-optional-list-page-stream)
23. [Resource Accessor Methods](#23-resource-accessor-methods)
24. [Repository Method Design](#24-repository-method-design)
25. [Domain Repository vs Data Repository](#25-domain-repository-vs-data-repository)
26. [Layering: API → Application → Domain → Data](#26-layering-api--application--domain--data)
27. [Jakarta Data dan Transaction Boundary](#27-jakarta-data-dan-transaction-boundary)
28. [Jakarta Data dan CDI](#28-jakarta-data-dan-cdi)
29. [Portability Model dan Batasannya](#29-portability-model-dan-batasannya)
30. [Relational Database Portability](#30-relational-database-portability)
31. [NoSQL Portability](#31-nosql-portability)
32. [Provider Extensions: Kapan Boleh Dipakai?](#32-provider-extensions-kapan-boleh-dipakai)
33. [Performance Engineering](#33-performance-engineering)
34. [Consistency, Locking, dan Concurrency](#34-consistency-locking-dan-concurrency)
35. [Error Handling](#35-error-handling)
36. [Security dan Data Access Policy](#36-security-dan-data-access-policy)
37. [Testing Strategy](#37-testing-strategy)
38. [Migration dari Repository Manual / Spring Data / JPA Repository](#38-migration-dari-repository-manual--spring-data--jpa-repository)
39. [Production Failure Modes](#39-production-failure-modes)
40. [Best Practices dan Anti-Patterns](#40-best-practices-dan-anti-patterns)
41. [Checklist Review](#41-checklist-review)
42. [Case Study 1: Case Repository untuk Regulatory System](#42-case-study-1-case-repository-untuk-regulatory-system)
43. [Case Study 2: Query Method Terlalu Pintar](#43-case-study-2-query-method-terlalu-pintar)
44. [Case Study 3: Provider-Specific Query yang Tidak Portable](#44-case-study-3-provider-specific-query-yang-tidak-portable)
45. [Case Study 4: Pagination Salah untuk Dataset Besar](#45-case-study-4-pagination-salah-untuk-dataset-besar)
46. [Latihan Bertahap](#46-latihan-bertahap)
47. [Mini Project: Jakarta Data Repository Lab](#47-mini-project-jakarta-data-repository-lab)
48. [Referensi Resmi](#48-referensi-resmi)

---

# 1. Orientasi: Kenapa Jakarta Data Muncul?

Sebelum Jakarta Data, Jakarta EE sudah memiliki Jakarta Persistence / JPA untuk object-relational mapping, persistence context, JPQL, Criteria API, transaction integration, dan lifecycle entity. JPA sangat kuat, tetapi banyak data access sehari-hari tetap repetitif.

Contoh repository manual dengan JPA:

```java
@ApplicationScoped
public class JpaCaseRepository {

    @PersistenceContext
    EntityManager em;

    public Optional<CaseEntity> findById(UUID id) {
        return Optional.ofNullable(em.find(CaseEntity.class, id));
    }

    public List<CaseEntity> findByStatus(CaseStatus status) {
        return em.createQuery(
            "select c from CaseEntity c " +
            "where c.status = :status " +
            "order by c.createdAt desc",
            CaseEntity.class
        )
        .setParameter("status", status)
        .getResultList();
    }

    public void insert(CaseEntity entity) {
        em.persist(entity);
    }

    public CaseEntity update(CaseEntity entity) {
        return em.merge(entity);
    }
}
```

Masalahnya bukan JPA buruk. Masalahnya, untuk operasi sederhana, terlalu banyak boilerplate.

Jakarta Data memungkinkan repository interface seperti ini:

```java
@Repository
public interface CaseRepository extends BasicRepository<CaseEntity, UUID> {

    List<CaseEntity> findByStatus(CaseStatus status);

    Optional<CaseEntity> findByCaseNumber(String caseNumber);
}
```

Provider Jakarta Data menyediakan implementation.

## 1.1 Masalah yang ingin dikurangi

Jakarta Data ingin mengurangi:

- repetitive CRUD boilerplate;
- repetitive query wiring;
- manual repository implementation untuk query sederhana;
- coupling code ke satu persistence technology;
- inconsistency antara style repository di banyak module;
- vendor-specific repository framework lock-in;
- friction saat bekerja dengan relational dan non-relational datastore.

## 1.2 Kenapa penting di Jakarta EE 11?

Jakarta Data 1.0 adalah spesifikasi baru dalam Jakarta EE 11. Ini membuat Jakarta ecosystem punya standard repository abstraction, bukan hanya bergantung pada framework non-standard.

## 1.3 Prinsip utama

> Jakarta Data should reduce boilerplate, not hide architecture.

Gunakan Jakarta Data untuk common data access. Jangan paksa semua persistence problem menjadi repository method name magic.

---

# 2. Mental Model: Repository Abstraction di Atas Persistence Provider

Jakarta Data berada di atas persistence technology.

```text
Application code
  ↓
Jakarta Data repository interface
  ↓
Jakarta Data provider
  ↓
Underlying persistence technology
      - Jakarta Persistence / JPA
      - Jakarta NoSQL
      - JDBC/provider-specific layer
      - document/key-value/graph store provider
  ↓
Database/storage
```

## 2.1 Repository interface sebagai contract

Kamu menulis interface:

```java
@Repository
public interface Garage extends BasicRepository<Car, Long> {
    List<Car> findByType(CarType type);
    Optional<Car> findByName(String name);
}
```

Provider membuat implementation.

## 2.2 Provider melakukan translation

Provider membaca method:

```java
findByType(CarType type)
```

lalu menerjemahkan ke operasi datastore.

Untuk relational database, ini mungkin menjadi SQL. Untuk document store, menjadi query document. Untuk key-value store, method seperti ini mungkin tidak bisa didukung kecuali `type` adalah key/index yang tersedia.

## 2.3 Persistence-agnostic bukan berarti database-agnostic sempurna

Jakarta Data tidak terikat pada satu database technology. Tetapi itu tidak berarti aplikasi bisa pindah dari PostgreSQL ke document database tanpa perubahan desain.

Kamu tetap harus memahami:

- index;
- transaction;
- isolation;
- consistency;
- query plan;
- pagination cost;
- sorting support;
- data model;
- locking;
- provider-specific behavior.

Repository abstraction tidak menghapus ilmu database.

---

# 3. Jakarta Data 1.0 dalam Jakarta EE 11

Jakarta Data 1.0 adalah release untuk Jakarta EE 11.

Jakarta EE 11 menempatkan Jakarta Data sebagai bagian dari upaya meningkatkan developer productivity. Jakarta Data menyederhanakan data access dengan memisahkan persistence logic dari model melalui interface sederhana.

## 3.1 Key features

Fitur yang perlu kamu pahami:

- `@Repository`;
- `BasicRepository`;
- `CrudRepository`;
- lifecycle methods;
- query methods;
- `@Find`, `@Delete`, `@Query`;
- Query by Method Name extension;
- pagination offset dan cursor;
- JDQL / Jakarta Data Query Language;
- portability guidance untuk relational dan NoSQL.

## 3.2 Jakarta Data masih 1.0

Karena ini spesifikasi awal, production adoption perlu hati-hati:

- provider support bisa berbeda;
- tooling masih berkembang;
- provider extension mungkin diperlukan;
- migration perlu pilot;
- performance harus diverifikasi dengan database nyata.

## 3.3 Posisi dalam Jakarta EE

Jakarta Data biasanya dipakai bersama:

- CDI untuk injection repository;
- Jakarta Persistence / JPA untuk relational persistence;
- Jakarta Transactions untuk transaction boundary;
- Jakarta Validation untuk input/entity validation;
- Jakarta REST untuk API layer.

---

# 4. Apa yang Jakarta Data Selesaikan

## 4.1 Boilerplate CRUD

Daripada menulis `findById`, `save`, `delete`, dan query sederhana berulang, built-in repository supertype menyediakan operasi umum.

## 4.2 Query sederhana

Daripada manual query string untuk lookup sederhana:

```java
Optional<Customer> findByEmail(String email);
```

Provider dapat mengimplementasikan query.

## 4.3 Standard repository style

Dalam enterprise codebase besar, standard style penting. Jakarta Data memberi vocabulary:

```text
@Repository
BasicRepository
CrudRepository
@Find
@Query
PageRequest
Sort
Limit
```

## 4.4 Separation of persistence and model

Repository interface menjadi boundary. Model/application tidak harus penuh dengan boilerplate `EntityManager`.

## 4.5 Multi-store programming model

Jakarta Data didesain agar bisa bekerja dengan berbagai datastore melalui provider, walaupun portability tidak absolut.

---

# 5. Apa yang Jakarta Data Tidak Coba Selesaikan

## 5.1 Tidak menggantikan JPA

Jakarta Data bukan pengganti Jakarta Persistence.

JPA tetap penting untuk:

- ORM mapping;
- persistence context;
- entity lifecycle;
- JPQL/Criteria;
- relationship mapping;
- locking;
- provider tuning;
- advanced persistence behavior.

Jakarta Data berada di layer lebih tinggi.

## 5.2 Tidak menggantikan Jakarta NoSQL

Jakarta Data bisa bekerja bersama NoSQL provider, tetapi tidak menggantikan spesifikasi NoSQL.

## 5.3 Tidak menyamakan semua database

Database punya capability berbeda:

- PostgreSQL full-text search;
- Oracle-specific SQL;
- MongoDB aggregation;
- Elasticsearch DSL;
- graph traversal;
- time-series query.

Jakarta Data tidak mencoba membuat semua fitur ini identical.

## 5.4 Tidak menggantikan domain modeling

Repository abstraction tidak menggantikan aggregate, invariant, policy, dan use case boundary.

---

# 6. Jakarta Data vs Jakarta Persistence / JPA

## 6.1 JPA level

JPA memberi kontrol detail:

```java
EntityManager
JPQL
Criteria API
mapping annotations
persistence context
transaction integration
```

## 6.2 Jakarta Data level

Jakarta Data memberi programming model lebih tinggi:

```java
repository interface
built-in repository methods
query methods
pagination/sorting abstraction
```

## 6.3 Analogi

```text
JPA:
  manual transmission, full control

Jakarta Data:
  automatic transmission for common routes
```

Automatic lebih nyaman, tetapi manual tetap diperlukan untuk terrain kompleks.

## 6.4 Kapan pilih JPA langsung?

Gunakan JPA langsung untuk:

- complex join/fetch strategy;
- entity graph;
- locking;
- bulk update/delete;
- dynamic criteria;
- native query;
- stored procedure;
- performance-critical query;
- provider-specific tuning.

## 6.5 Kapan pilih Jakarta Data?

Gunakan Jakarta Data untuk:

- CRUD;
- simple lookup;
- simple filtered list;
- pagination/sorting;
- repository boilerplate reduction;
- standard repository abstraction.

---

# 7. Jakarta Data vs Spring Data

## 7.1 Similar goals

Spring Data:

```java
interface CustomerRepository extends JpaRepository<Customer, Long> {
    Optional<Customer> findByEmail(String email);
}
```

Jakarta Data:

```java
@Repository
interface CustomerRepository extends BasicRepository<Customer, Long> {
    Optional<Customer> findByEmail(String email);
}
```

## 7.2 Perbedaan ecosystem

Spring Data:

- bagian dari Spring ecosystem;
- sangat matang;
- banyak module store;
- kaya fitur;
- terintegrasi dengan Spring Boot.

Jakarta Data:

- Jakarta standard;
- bagian Jakarta EE 11;
- versi awal 1.0;
- fokus standard programming model;
- provider support berkembang.

## 7.3 Jangan copy mental model mentah

Jika kamu datang dari Spring Data, cek ulang:

- keyword method name;
- pagination classes;
- transaction defaults;
- projections;
- custom implementation;
- repository scanning;
- provider support.

Migration bukan find/replace.

---

# 8. Jakarta Data vs Jakarta NoSQL

Jakarta NoSQL menyediakan API untuk NoSQL database interaction. Jakarta Data menyediakan repository programming model.

```text
Jakarta Data = repository abstraction
Jakarta NoSQL = NoSQL-specific persistence API/model
```

Keduanya bisa saling melengkapi.

## 8.1 NoSQL tidak bisa diperlakukan seperti relational

NoSQL kategori berbeda:

- key-value;
- document;
- wide-column;
- graph;
- time-series;
- search.

Repository method harus mengikuti access pattern datastore.

---

# 9. Dependency, Provider, dan Runtime

## 9.1 API dependency

Individual artifact:

```xml
<dependency>
  <groupId>jakarta.data</groupId>
  <artifactId>jakarta.data-api</artifactId>
  <version>1.0.0</version>
</dependency>
```

Dalam Jakarta EE 11, API bisa juga hadir melalui aggregate Platform/Web API sesuai runtime target.

## 9.2 API jar bukan provider

```text
jakarta.data-api ≠ implementation
```

Kamu butuh Jakarta Data provider/runtime.

## 9.3 Provider responsibility

Provider bertanggung jawab untuk:

- menemukan repository interface;
- generate/provide implementation;
- menerjemahkan query;
- menghubungkan ke datastore;
- integrate dengan CDI;
- handle pagination/sorting;
- validasi supported method patterns.

## 9.4 Build-time vs runtime implementation

Provider bisa memakai:

- build-time generation;
- runtime proxy;
- CDI extension;
- annotation processing;
- bytecode generation;
- reflection.

Ini memengaruhi startup, error timing, dan debugging.

---

# 10. Peta API Jakarta Data

Jakarta Data API berada di module `jakarta.data`.

Paket penting:

```text
jakarta.data.repository
jakarta.data.page
jakarta.data.metamodel
jakarta.data.exceptions
```

## 10.1 `jakarta.data.repository`

Berisi:

- `@Repository`;
- `DataRepository`;
- `BasicRepository`;
- `CrudRepository`;
- lifecycle annotations;
- query annotations.

## 10.2 `jakarta.data.page`

Berisi abstraction untuk pagination, page request, cursor/offset, sort/order/limit concepts.

## 10.3 Exceptions

Berisi exceptions terkait data/repository behavior. Tetap cek mapping provider terhadap exception database aktual.

---

# 11. `@Repository`: Interface sebagai Contract

`@Repository` menandai interface repository.

```java
@Repository
public interface CustomerRepository extends BasicRepository<Customer, Long> {

    Optional<Customer> findByEmail(String email);

    List<Customer> findByStatus(CustomerStatus status, Sort<Customer> sort);
}
```

## 11.1 Repository should be interface

Kamu mendefinisikan contract. Provider menyediakan implementation.

## 11.2 Naming

Good:

```java
CaseEntityRepository
CustomerRepository
LicenseApplicationRepository
OfficerAssignmentRepository
```

Bad:

```java
DBHelper
RepositoryManager
DataStuff
```

## 11.3 Repository size

Jika repository punya 80 method, mungkin perlu split:

- command repository;
- query repository;
- search repository;
- read model repository;
- domain-specific adapter.

---

# 12. Built-in Repository Supertypes: `DataRepository`, `BasicRepository`, `CrudRepository`

Jakarta Data mendefinisikan built-in generic repository supertypes.

## 12.1 `DataRepository`

Base repository supertype. Cocok jika ingin repository identity tanpa expose full CRUD.

## 12.2 `BasicRepository`

Built-in repository supertype untuk basic operations pada entities.

```java
@Repository
public interface Garage extends BasicRepository<Car, Long> {
    List<Car> findByType(CarType type);
}
```

## 12.3 `CrudRepository`

Repository supertype untuk operasi CRUD umum.

## 12.4 Jangan expose capability sembarangan

Jika domain tidak memperbolehkan delete, jangan mewarisi repository yang expose delete tanpa kontrol.

Buruk:

```java
interface RegulatoryCaseRepository extends CrudRepository<CaseEntity, UUID> {}
```

Jika `delete` tersedia padahal regulatory case harus retained, ini berbahaya.

## 12.5 Supertype adalah capability

Memilih `CrudRepository` bukan sekadar convenience. Itu memberi izin operasi kepada application code.

---

# 13. Entity Classes dalam Jakarta Data

Jakarta Data menggunakan konsep entity sebagai building block data model.

## 13.1 Entity bisa relational atau non-relational

Dalam JPA:

```java
@Entity
public class Customer {
    @Id
    private Long id;
}
```

Dalam document store/provider lain, mapping bisa berbeda.

## 13.2 Persistent field/property names penting

Nama persistent field/property dipakai oleh:

- automatic query method;
- Query by Method Name;
- `@Query`.

Jika field bernama `caseNumber`, method `findByCaseNumber` masuk akal.

## 13.3 Entity bukan DTO

Jangan return entity langsung dari REST API hanya karena repository mengembalikannya.

```text
Entity → internal persistence model
DTO → API contract
```

## 13.4 Entity bukan selalu aggregate

Untuk domain kaya, persistence entity dan domain aggregate bisa berbeda.

---

# 14. Identifier, Entity Type, dan Primary Entity Type

Generic repository biasanya punya entity type dan identifier type:

```java
BasicRepository<CaseEntity, UUID>
```

- `CaseEntity` = entity type;
- `UUID` = ID type.

## 14.1 Primary entity type

Untuk built-in repository superinterface, primary entity type ditentukan dari generic parameter pertama.

## 14.2 ID design

Pilihan ID:

- `Long`;
- `UUID`;
- `String` natural key;
- domain-specific wrapper;
- composite key.

Provider support untuk custom ID wrapper harus diuji.

## 14.3 Domain-specific ID

```java
public record CaseId(UUID value) {}
```

Bagus untuk domain, tetapi mapping/provider support harus diverifikasi.

---

# 15. Lifecycle Operations: Insert, Update, Save, Delete

Jakarta Data punya lifecycle annotations:

- `@Insert`;
- `@Update`;
- `@Save`;
- `@Delete`.

## 15.1 Insert

```java
@Insert
CaseEntity insert(CaseEntity entity);
```

Untuk entity baru.

## 15.2 Update

```java
@Update
CaseEntity update(CaseEntity entity);
```

Untuk entity existing.

## 15.3 Save

```java
@Save
CaseEntity save(CaseEntity entity);
```

Bisa merepresentasikan insert/update style behavior tergantung semantics/provider.

## 15.4 Delete

```java
@Delete
void delete(CaseEntity entity);
```

## 15.5 Jangan blur business semantics

Jika command adalah create, gunakan insert. Jika revise existing, gunakan update. Jika semua pakai save, accidental create/update bisa tersembunyi.

## 15.6 Transaction tetap penting

Repository operation tidak otomatis menggantikan transaction boundary use case.

---

# 16. Query Model: Tiga Cara Menulis Query

Jakarta Data menyediakan dua core ways:

1. parameter-based automatic query methods seperti `@Find` dan `@Delete`;
2. annotated query methods seperti `@Query` dengan JDQL atau JPQL.

Jakarta Data 1.0 juga mensyaratkan Query by Method Name extension untuk migration path dari repository framework lain.

## 16.1 Parameter-based automatic query

```java
@Find
List<Customer> customersByStatus(CustomerStatus status);
```

## 16.2 Annotated query

```java
@Query("where status = :status order by createdAt desc")
List<Customer> findRecent(CustomerStatus status, Limit limit);
```

## 16.3 Query by Method Name

```java
List<Customer> findByStatusOrderByCreatedAtDesc(CustomerStatus status);
```

## 16.4 Choosing approach

| Query kind | Recommended |
|---|---|
| Simple equality lookup | method name / `@Find` |
| Simple filtered list | `@Find` or method name |
| Complex predicate | `@Query` |
| Joins/fetch/performance-specific | JPA/provider explicit |
| Vendor-specific feature | provider query/adapter |
| Business-specific read model | explicit repository implementation |

---

# 17. Parameter-Based Automatic Query Methods: `@Find` dan `@Delete`

## 17.1 `@Find`

```java
@Find
List<CaseEntity> findByStatus(CaseStatus status);
```

Parameter dipetakan ke persistent field/property.

## 17.2 Parameter names matter

Jakarta Data spec menyatakan parameter harus punya type dan name yang sama dengan persistent field/property, atau menjadi special parameter seperti `Limit`, `Order`, `PageRequest`, atau `Sort`.

Karena itu, compile dengan parameter names:

```xml
<plugin>
  <groupId>org.apache.maven.plugins</groupId>
  <artifactId>maven-compiler-plugin</artifactId>
  <configuration>
    <parameters>true</parameters>
  </configuration>
</plugin>
```

## 17.3 `@Delete`

```java
@Delete
long deleteByStatus(CaseStatus status);
```

Gunakan sangat hati-hati, terutama di sistem regulated.

## 17.4 Delete policy

Untuk data yang harus retained, prefer:

```text
status = ARCHIVED
status = DELETED
valid_to timestamp
```

daripada physical delete.

---

# 18. `@Query`: JDQL, JPQL, dan Provider-Specific Query

`@Query` digunakan untuk query eksplisit.

## 18.1 JDQL

Jakarta Data Query Language adalah query language yang dirancang untuk repository methods dalam Jakarta Data.

## 18.2 JPQL

Provider Jakarta Persistence-backed bisa mendukung JPQL. Namun provider Jakarta Data tidak wajib mendukung seluruh JPQL.

## 18.3 Example

```java
@Query("where status = :status and assignedOfficerId = :officerId order by createdAt desc")
List<CaseEntity> findAssignedCases(
    CaseStatus status,
    OfficerId officerId,
    Limit limit
);
```

## 18.4 Portability warning

`@Query` portable jika memakai JDQL yang semantics-nya bisa diimplementasikan oleh provider/datastore. JPQL lengkap atau vendor-specific extension menurunkan portability.

## 18.5 When to use

Gunakan `@Query` saat:

- method name terlalu panjang;
- predicate kompleks;
- query perlu review eksplisit;
- sorting/static condition jelas;
- readability lebih baik dari method-name query.

---

# 19. Query by Method Name: Useful, Tapi Harus Hati-Hati

Query by Method Name familiar untuk developer Spring Data.

```java
List<CaseEntity> findByStatusAndAssignedOfficerIdOrderByCreatedAtDesc(
    CaseStatus status,
    OfficerId assignedOfficerId
);
```

## 19.1 Benefit

- cepat untuk simple query;
- tidak perlu query string;
- familiar;
- compile-time method existence.

## 19.2 Problem

Method name bisa menjadi DSL tidak terbaca:

```java
findByStatusAndTypeAndOfficerAndCreatedAtBetweenAndPriorityInAndDeletedFalseOrderByCreatedAtDesc
```

## 19.3 Future note

Jakarta Data 1.0 mensyaratkan provider mendukung Query by Method Name, tetapi requirement ini disebut akan dihapus di versi masa depan. Untuk code baru yang mengejar future portability, jangan terlalu bergantung pada method-name DSL kompleks.

## 19.4 Rule

Gunakan method-name query hanya untuk simple lookup.

---

# 20. Special Parameters: `Limit`, `Order`, `Sort`, `PageRequest`

Jakarta Data memiliki special parameters untuk limit, sorting, dan pagination.

## 20.1 Limit

```java
List<CaseEntity> findByStatus(CaseStatus status, Limit limit);
```

## 20.2 Sort

```java
List<CaseEntity> findByStatus(CaseStatus status, Sort<CaseEntity> sort);
```

## 20.3 PageRequest

```java
Page<CaseEntity> findByStatus(CaseStatus status, PageRequest pageRequest);
```

## 20.4 Allowlist sort

Jangan menerima sort field mentah dari user.

Bad:

```text
sort=request.getParameter("sort")
```

Good:

```java
enum CaseSortField {
    CREATED_AT,
    UPDATED_AT,
    PRIORITY
}
```

Map enum ke field yang diizinkan.

## 20.5 Index awareness

Sorting butuh index. Sorting pada unindexed column di table besar dapat membunuh performance.

---

# 21. Pagination: Offset vs Cursor

Jakarta Data mendukung offset dan cursor pagination.

## 21.1 Offset pagination

```text
page=10&size=20
```

Equivalent:

```sql
offset 200 limit 20
```

Cocok untuk:

- UI sederhana;
- dataset kecil/menengah;
- random page navigation.

Buruk untuk:

- offset sangat besar;
- data sering berubah;
- audit log besar;
- infinite scroll.

## 21.2 Cursor pagination

Cursor memakai token/keyset.

Cocok untuk:

- feed;
- audit log;
- event stream;
- dataset besar;
- stable traversal.

## 21.3 Stable ordering

Pagination wajib punya deterministic ordering.

Bad:

```text
where status = OPEN limit 20
```

Good:

```text
order by createdAt desc, id desc
```

## 21.4 Cursor needs tie-breaker

Jika sort by `createdAt`, tambahkan `id` sebagai tie-breaker.

---

# 22. Return Types: Entity, Optional, List, Page, Stream

Spec mendorong provider mendukung return types seperti:

- `T`;
- `Optional<T>`;
- `List<T>`;
- `Page<T>`;
- array;
- `void` untuk query tanpa result.

## 22.1 Optional for normal absence

```java
Optional<Customer> findByEmail(String email);
```

Jika tidak ditemukan adalah normal, gunakan `Optional`.

## 22.2 List for bounded collections

```java
List<Customer> findByStatus(CustomerStatus status, Limit limit);
```

Jangan unbounded untuk dataset besar.

## 22.3 Page for API pagination

```java
Page<Customer> findByStatus(CustomerStatus status, PageRequest page);
```

## 22.4 Stream caution

Jika Stream membuka cursor/connection, harus ditutup.

Jangan return Stream melewati layer boundary tanpa lifecycle jelas.

---

# 23. Resource Accessor Methods

Jakarta Data repository dapat memiliki resource accessor method. Untuk provider JDBC-backed, spec menyarankan support resource accessor method type `java.sql.Connection`.

## 23.1 Use case

- legacy integration;
- specialized query;
- diagnostics;
- escape hatch.

## 23.2 Risk

Direct resource access dapat merusak abstraction:

- connection lifecycle;
- transaction integration;
- portability;
- resource leak.

## 23.3 Rule

Gunakan resource accessor secara terbatas dan dokumentasikan.

---

# 24. Repository Method Design

## 24.1 Method harus jelas

Good:

```java
Optional<CaseEntity> findByCaseNumber(String caseNumber);
List<CaseEntity> findByStatus(CaseStatus status, Limit limit);
Page<CaseEntity> findByAssignedOfficerId(OfficerId officerId, PageRequest page);
```

## 24.2 Avoid method explosion

Jika kombinasi filter terlalu banyak, gunakan explicit query/search adapter.

## 24.3 Jangan expose repository langsung ke REST

Bad:

```java
@Path("/cases")
public class CaseResource {
    @Inject CaseEntityRepository repository;

    @GET
    public List<CaseEntity> list() {
        return repository.findAll();
    }
}
```

Better:

```text
Resource → Application Service → Repository
```

## 24.4 Command vs query repository

Pisahkan jika perlu:

```java
CaseCommandRepository
CaseQueryRepository
```

---

# 25. Domain Repository vs Data Repository

Ini bagian paling penting secara architecture.

## 25.1 Data repository

```java
@Repository
interface CaseEntityRepository extends BasicRepository<CaseEntity, UUID> {
    Optional<CaseEntity> findByCaseNumber(String caseNumber);
}
```

Fokus pada persistence entity.

## 25.2 Domain repository

```java
interface CaseRepository {
    EnforcementCase get(CaseId id);
    void save(EnforcementCase aggregate);
}
```

Fokus pada aggregate/domain contract.

## 25.3 Kapan disatukan?

Untuk simple CRUD, bisa disatukan.

Untuk domain kaya/regulatory system, pisahkan.

## 25.4 Mengapa pisah?

Domain repository dapat menjaga:

- aggregate boundary;
- invariant;
- mapping;
- locking;
- event extraction;
- audit;
- soft delete;
- authorization filtering.

## 25.5 Jakarta Data sebagai infrastructure helper

```text
Application service
  ↓
Domain repository interface
  ↓
Infrastructure adapter
  ↓
Jakarta Data repository
  ↓
Database
```

---

# 26. Layering: API → Application → Domain → Data

## 26.1 API layer

```java
@Path("/cases")
public class CaseResource {

    @Inject
    ApproveCaseUseCase approveCase;

    @POST
    @Path("/{id}/approve")
    public Response approve(@PathParam("id") UUID id, ApproveCaseRequest request) {
        ApproveCaseResult result = approveCase.handle(...);
        return Response.ok(result).build();
    }
}
```

## 26.2 Application layer

```java
@ApplicationScoped
public class ApproveCaseUseCase {

    private final CaseRepository caseRepository;
    private final AuditTrail auditTrail;

    @Inject
    public ApproveCaseUseCase(CaseRepository caseRepository, AuditTrail auditTrail) {
        this.caseRepository = caseRepository;
        this.auditTrail = auditTrail;
    }

    @Transactional
    public ApproveCaseResult handle(ApproveCase command) {
        EnforcementCase c = caseRepository.get(command.caseId());
        c.approve(command.actor(), command.reason());
        caseRepository.save(c);
        auditTrail.record(c.pullEvents());
        return ApproveCaseResult.from(c);
    }
}
```

## 26.3 Domain layer

```java
public final class EnforcementCase {
    public void approve(Actor actor, Reason reason) {
        if (!canApprove()) {
            throw new InvalidCaseState(...);
        }
        ...
    }
}
```

No Jakarta Data annotation.

## 26.4 Infrastructure/data layer

```java
@Repository
public interface CaseEntityRepository extends BasicRepository<CaseEntity, UUID> {
    Optional<CaseEntity> findByCaseNumber(String caseNumber);
}
```

Adapter:

```java
@ApplicationScoped
public class JpaCaseRepository implements CaseRepository {

    @Inject
    CaseEntityRepository entities;

    @Override
    public EnforcementCase get(CaseId id) {
        CaseEntity entity = entities.findById(id.value())
            .orElseThrow(...);
        return mapper.toDomain(entity);
    }

    @Override
    public void save(EnforcementCase aggregate) {
        entities.save(mapper.toEntity(aggregate));
    }
}
```

---

# 27. Jakarta Data dan Transaction Boundary

Repository method bukan selalu transaction boundary.

## 27.1 Use case transaction

```java
@Transactional
public void approve(ApproveCase command) {
    Case c = repository.get(command.caseId());
    c.approve(...);
    repository.save(c);
}
```

Transaction mencakup seluruh use case.

## 27.2 Jangan transaction per method tanpa sadar

Jika load/update/save terpisah transaction, consistency bisa rusak.

## 27.3 External call caution

Jangan hold DB transaction sambil memanggil external HTTP service lambat.

## 27.4 Read-only transaction

Untuk query, read-only transaction bisa membantu consistency/resource management tergantung provider.

## 27.5 JTA integration

Jika provider berbasis JPA/JTA, transaction mengikuti Jakarta Transactions/provider integration.

---

# 28. Jakarta Data dan CDI

Repository dapat diinject:

```java
@Inject
CaseEntityRepository repository;
```

Provider menyediakan CDI bean/proxy implementation.

## 28.1 Failure mode

Repository injection bisa gagal jika:

- provider tidak tersedia;
- repository interface tidak ditemukan;
- `@Repository` tidak ada;
- package tidak discan;
- runtime tidak support Jakarta Data;
- build-time processor tidak jalan.

## 28.2 Scope

Repository proxy sebaiknya stateless/thread-safe. Jangan simpan request-specific mutable state di repository.

## 28.3 Test

CDI integration test harus membuktikan repository bisa diinject dan method berjalan.

---

# 29. Portability Model dan Batasannya

Jakarta Data dirancang persistence-agnostic, unified, pluggable, extensible, dan domain-centric. Namun portability tidak absolut.

## 29.1 Lebih portable

- built-in repository methods;
- basic lifecycle operations;
- simple parameter-based queries;
- JDQL query subset;
- pagination/sorting abstraction;
- common return types.

## 29.2 Kurang portable

- native SQL;
- provider-specific annotation;
- database-specific function;
- JPQL feature di luar JDQL subset;
- resource accessor;
- custom return type;
- datastore-specific query.

## 29.3 Provider extension

Provider boleh mendukung lebih dari spec, tetapi aplikasi yang memakai extension tidak portable.

## 29.4 Document assumptions

Untuk setiap repository critical, catat:

```text
Portable Jakarta Data feature? yes/no
JDQL? yes/no
JPQL? yes/no
Provider-specific? yes/no
Database-specific? yes/no
```

---

# 30. Relational Database Portability

Untuk relational provider, spec menyatakan provider harus mendukung lifecycle annotations `@Insert`, `@Update`, `@Delete`, built-in repository types `BasicRepository` dan `CrudRepository`, serta query methods termasuk pagination, ordering, dan limiting, dengan catatan operasi tetap dibatasi dialect/database.

## 30.1 Relational strengths

- joins;
- transactions;
- constraints;
- indexes;
- aggregation;
- consistency.

## 30.2 Risk dengan abstraction

- hidden N+1;
- generated query tidak optimal;
- sorting tanpa index;
- offset pagination lambat;
- count query mahal;
- fetch plan tidak jelas.

## 30.3 Index design

Method:

```java
findByStatusAndAssignedOfficerIdOrderByCreatedAtDesc
```

Butuh index yang sesuai, misalnya:

```sql
(status, assigned_officer_id, created_at desc)
```

sesuai database/dialect.

## 30.4 Explain plan

Untuk query critical:

- inspect generated query;
- run EXPLAIN;
- test dengan data realistis;
- monitor slow query.

---

# 31. NoSQL Portability

## 31.1 Key-value

Minimum support bisa terbatas ke key/id operations. Query non-key kompleks mungkin `UnsupportedOperationException`.

## 31.2 Wide-column

Query flexibility tergantung partition/index design. Keyword tertentu mungkin tidak didukung universal.

## 31.3 Document database

Query lebih fleksibel, tetapi denormalization, index, dan query operator tetap provider-specific.

## 31.4 Graph database

Graph query semantics berbeda dari relational. Portability terbatas pada bentuk yang didukung spec/provider.

## 31.5 Rule

Design repository berdasarkan access pattern datastore.

---

# 32. Provider Extensions: Kapan Boleh Dipakai?

Provider extension tidak jahat. Ia boleh dipakai jika trade-off jelas.

## 32.1 Use cases

- full-text search;
- native SQL;
- database-specific function;
- graph traversal;
- aggregation pipeline;
- vector search;
- performance tuning.

## 32.2 ADR wajib

```markdown
# ADR: Use provider-specific query in DocumentSearchRepository

## Context
Search membutuhkan ranking dan full-text operator database.

## Decision
Gunakan query provider-specific.

## Consequences
Tidak portable lintas database/provider.

## Mitigation
Isolasi di adapter, integration test dengan target database, dokumentasikan query plan.
```

## 32.3 Isolate extension

Jangan sebar native/provider query di seluruh codebase.

---

# 33. Performance Engineering

## 33.1 Repository abstraction can hide cost

Method sederhana bisa mahal:

```java
findByStatus(status)
```

Pertanyaan wajib:

- berapa rows match?
- ada index?
- query generated apa?
- sort apa?
- pagination apa?
- fetch plan apa?
- transaction apa?

## 33.2 Avoid unbounded list

Bad:

```java
List<CaseEntity> findByStatus(CaseStatus status);
```

Better:

```java
Page<CaseEntity> findByStatus(CaseStatus status, PageRequest page);
```

or:

```java
List<CaseEntity> findByStatus(CaseStatus status, Limit limit, Sort<CaseEntity> sort);
```

## 33.3 N+1

Repository returning entities can trigger lazy loading later.

Use explicit fetch/projection/read model for critical read.

## 33.4 Count query

Page total count bisa mahal. Untuk large table, cursor/slice pattern bisa lebih baik.

## 33.5 Measure

Gunakan:

- generated SQL logs;
- bind parameter logs;
- DB slow query log;
- EXPLAIN;
- JFR;
- load test.

---

# 34. Consistency, Locking, dan Concurrency

Jakarta Data tidak menghapus concurrency problem.

## 34.1 Tetap butuh

- optimistic locking;
- pessimistic locking;
- unique constraints;
- idempotency keys;
- transaction boundary;
- compare-and-set;
- version field.

## 34.2 Race condition example

```text
request A checks exists false
request B checks exists false
both insert
```

Solusi:

```text
database unique constraint + exception mapping
```

## 34.3 Locking detail

Fine-grained locking mungkin tidak portable lewat Jakarta Data. Gunakan JPA/provider explicit jika perlu.

## 34.4 Delete concurrency

Physical delete berisiko. Untuk regulated app, prefer soft delete/archive.

---

# 35. Error Handling

Data access bisa gagal karena:

- connection issue;
- timeout;
- constraint violation;
- optimistic lock;
- deadlock;
- unsupported operation;
- query syntax;
- mapping error;
- provider bug.

## 35.1 Map ke application error

Contoh mapping:

```text
not found → 404
optimistic lock → 409
unique constraint → 409/400
unsupported operation → deployment/config error
timeout → 503/504
```

## 35.2 UnsupportedOperationException

Jika repository method tidak supported provider, itu harus dianggap design/runtime issue, bukan normal user error.

## 35.3 Retry

Retry hanya untuk transient failure dan idempotent operation.

---

# 36. Security dan Data Access Policy

Repository bukan authorization boundary by default.

## 36.1 Data-level authorization

Jangan hanya:

```java
repository.findByCaseId(caseId)
```

lalu return ke user.

Harus ada:

```java
authorization.checkCanView(actor, case)
```

atau query yang memasukkan tenant/jurisdiction/actor scope.

## 36.2 Multi-tenancy

```java
findByTenantIdAndCaseNumber(TenantId tenantId, String caseNumber)
```

atau provider/runtime tenant isolation.

## 36.3 Sensitive data

Jangan log query params yang mengandung PII/secrets.

## 36.4 Delete policy

Repository delete harus dilindungi oleh domain/data retention policy.

---

# 37. Testing Strategy

## 37.1 Unit test application logic

Gunakan fake domain repository.

```java
class InMemoryCaseRepository implements CaseRepository { ... }
```

## 37.2 Integration test Jakarta Data repository

Test repository dengan provider/database nyata:

- Testcontainers;
- embedded runtime;
- target Jakarta EE runtime;
- same database type as production.

## 37.3 Test every repository method

- success;
- no result;
- multiple result;
- pagination;
- sorting;
- constraint violation;
- transaction behavior;
- unsupported operation.

## 37.4 Performance test

Untuk query critical:

- realistic row count;
- EXPLAIN plan;
- index check;
- latency budget;
- slow query monitoring.

## 37.5 Concurrency test

- duplicate insert;
- optimistic lock conflict;
- delete/update race;
- idempotent retry.

---

# 38. Migration dari Repository Manual / Spring Data / JPA Repository

## 38.1 From manual JPA

Before:

```java
@ApplicationScoped
public class CustomerRepository {
    @PersistenceContext EntityManager em;
    public Optional<Customer> findByEmail(String email) { ... }
}
```

After:

```java
@Repository
public interface CustomerDataRepository extends BasicRepository<Customer, Long> {
    Optional<Customer> findByEmail(String email);
}
```

## 38.2 From Spring Data

Spring Data:

```java
interface CustomerRepository extends JpaRepository<Customer, Long> {
    Optional<Customer> findByEmail(String email);
}
```

Jakarta Data:

```java
@Repository
interface CustomerRepository extends BasicRepository<Customer, Long> {
    Optional<Customer> findByEmail(String email);
}
```

But verify semantics.

## 38.3 Migration strategy

1. Inventory repository methods.
2. Classify simple vs complex.
3. Migrate simple CRUD/lookups first.
4. Keep complex query explicit.
5. Add integration tests.
6. Compare generated query/result.
7. Roll out gradually.
8. Document provider-specific gaps.

## 38.4 Do not big-bang migrate

Jakarta Data 1.0 is new. Pilot first.

---

# 39. Production Failure Modes

## 39.1 Repository bean not found

Causes:

- missing provider;
- missing `@Repository`;
- repository not scanned;
- runtime does not support Jakarta Data.

## 39.2 Method unsupported

Causes:

- unsupported query method pattern;
- datastore lacks operation;
- invalid return type;
- provider extension missing.

## 39.3 Parameter names missing

Cause:

- compile without `-parameters`.

## 39.4 Slow query

Causes:

- no index;
- unbounded list;
- high offset;
- expensive sort;
- generated query inefficient;
- N+1.

## 39.5 Pagination inconsistent

Causes:

- no deterministic order;
- concurrent writes;
- offset pagination over changing data;
- cursor missing tie-breaker.

## 39.6 Wrong transaction semantics

Causes:

- repository call outside transaction;
- use case split across transactions;
- provider auto-transaction assumption wrong.

## 39.7 Security leak

Causes:

- missing tenant/jurisdiction filter;
- repository exposed directly to REST;
- returned entity has sensitive fields.

---

# 40. Best Practices dan Anti-Patterns

## 40.1 Best practices

- Use Jakarta Data for simple/common repository operations.
- Keep complex query explicit.
- Compile with parameter names if using parameter-based queries.
- Always paginate/limit large results.
- Design indexes for repository methods.
- Separate domain repository from data repository for rich domains.
- Keep transaction boundary in application service.
- Use `Optional<T>` for normal not-found.
- Avoid exposing delete if domain forbids it.
- Document provider-specific queries.
- Test repository methods with real database/provider.
- Inspect generated queries for critical paths.

## 40.2 Anti-pattern: Repository as business service

Bad:

```java
repository.approveCaseAndNotifyOfficerAndCloseTickets(...)
```

That is application service/business workflow, not repository.

## 40.3 Anti-pattern: Method name DSL madness

Bad:

```java
findByStatusAndTypeAndOfficerAndCreatedAtBetweenAndPriorityInAndDeletedFalseOrderByCreatedAtDesc
```

Use `@Query` or explicit implementation.

## 40.4 Anti-pattern: Unbounded `findAll`

Bad in production on large data.

## 40.5 Anti-pattern: Treating portability as magic

Portability has limits. Document tested providers/datastores.

---

# 41. Checklist Review

## 41.1 Repository design

- [ ] Is repository interface annotated `@Repository`?
- [ ] Does it expose only needed operations?
- [ ] Is `CrudRepository` justified?
- [ ] Is physical delete allowed?
- [ ] Are method names readable?
- [ ] Are complex queries explicit?

## 41.2 Domain layering

- [ ] Is domain model free from data access dependency?
- [ ] Is data repository separate from domain repository where needed?
- [ ] Does application service own transaction boundary?
- [ ] Does repository avoid business workflow logic?

## 41.3 Query safety

- [ ] Are large result methods paginated/limited?
- [ ] Is sorting allowlisted?
- [ ] Are indexes designed?
- [ ] Is generated query inspected?
- [ ] Is count query cost acceptable?
- [ ] Is cursor pagination used for large feeds?

## 41.4 Portability

- [ ] Is query JDQL or provider-specific?
- [ ] Are provider extensions documented?
- [ ] Is database-specific behavior isolated?
- [ ] Are unsupported operations tested?

## 41.5 Runtime

- [ ] Jakarta Data provider available?
- [ ] Runtime supports Jakarta Data 1.0?
- [ ] CDI injection works?
- [ ] Repository discovered?
- [ ] Build-time/runtime errors caught in CI?

## 41.6 Security

- [ ] Tenant/jurisdiction/authorization filters included?
- [ ] Sensitive data not exposed?
- [ ] Delete/update protected?
- [ ] Audit events recorded?

---

# 42. Case Study 1: Case Repository untuk Regulatory System

## 42.1 Requirement

Sistem regulatory case management:

- case has status;
- assigned officer;
- jurisdiction;
- priority;
- created date;
- audit requirement;
- no physical delete;
- pagination required;
- officer can only see assigned/jurisdiction cases.

## 42.2 Bad repository

```java
@Repository
interface CaseRepository extends CrudRepository<CaseEntity, UUID> {
    List<CaseEntity> findByStatus(CaseStatus status);
}
```

Problems:

- exposes delete;
- unbounded list;
- no jurisdiction filter;
- no assigned officer filter;
- returns entity directly;
- no ordering.

## 42.3 Better data repository

```java
@Repository
interface CaseEntityRepository extends BasicRepository<CaseEntity, UUID> {

    Page<CaseEntity> findByStatusAndJurisdictionId(
        CaseStatus status,
        JurisdictionId jurisdictionId,
        PageRequest page
    );

    Optional<CaseEntity> findByCaseNumberAndJurisdictionId(
        String caseNumber,
        JurisdictionId jurisdictionId
    );
}
```

## 42.4 Application service owns policy

```java
@ApplicationScoped
public class ListCasesUseCase {

    private final CaseEntityRepository cases;
    private final AuthorizationPolicy authorization;

    @Inject
    public ListCasesUseCase(
        CaseEntityRepository cases,
        AuthorizationPolicy authorization
    ) {
        this.cases = cases;
        this.authorization = authorization;
    }

    public Page<CaseSummary> list(Actor actor, CaseStatus status, PageRequest page) {
        JurisdictionId jurisdiction = authorization.requiredJurisdiction(actor);
        return cases.findByStatusAndJurisdictionId(status, jurisdiction, page)
            .map(CaseSummary::from);
    }
}
```

## 42.5 Key lesson

Repository method membantu data boundary, tetapi authorization decision tetap application/domain policy.

---

# 43. Case Study 2: Query Method Terlalu Pintar

## 43.1 Problem

```java
List<ApplicationEntity>
findByStatusAndApplicantTypeAndSubmittedAtBetweenAndAssignedOfficerIdAndDeletedFalseOrderBySubmittedAtDesc(...)
```

## 43.2 Symptoms

- unreadable;
- hard to refactor;
- easy to get parameter order wrong;
- no obvious query plan;
- method grows with new filters.

## 43.3 Fix

Use explicit query:

```java
@Query("where status = :status and applicantType = :applicantType and deleted = false order by submittedAt desc")
List<ApplicationEntity> search(..., Limit limit);
```

or explicit search adapter.

## 43.4 Lesson

Method-name query is not full search DSL.

---

# 44. Case Study 3: Provider-Specific Query yang Tidak Portable

## 44.1 Problem

Repository uses provider-specific SQL/full-text query but team claims it is portable.

## 44.2 Reality

Full-text search is database-specific.

## 44.3 Fix

Document ADR and isolate:

```java
interface DocumentSearchPort {
    Page<DocumentSearchResult> search(DocumentSearchQuery query);
}
```

Implementation:

```java
PostgresDocumentSearchAdapter
```

## 44.4 Lesson

Provider-specific feature is acceptable only when intentional, isolated, tested, and documented.

---

# 45. Case Study 4: Pagination Salah untuk Dataset Besar

## 45.1 Problem

```http
GET /audit-events?page=50000&size=50
```

Offset pagination becomes slow.

## 45.2 Fix

Use cursor pagination:

```http
GET /audit-events?after=cursor-token&size=50
```

Order:

```text
createdAt desc, id desc
```

## 45.3 Lesson

Pagination strategy is architecture decision, not repository convenience only.

---

# 46. Latihan Bertahap

## Latihan 1 — Basic repository

Buat entity `Customer` dan repository:

```java
@Repository
interface CustomerRepository extends BasicRepository<Customer, Long> {
    Optional<Customer> findByEmail(String email);
}
```

Test insert/find.

## Latihan 2 — Parameter names

Buat parameter-based query. Compile tanpa `-parameters`, lalu dengan `-parameters`. Amati behavior provider.

## Latihan 3 — Query by Method Name

Buat simple query method, lalu buat method name terlalu panjang. Refactor ke `@Query`.

## Latihan 4 — Pagination

Buat `findByStatus` dengan `PageRequest`.

## Latihan 5 — Prevent delete

Bandingkan `CrudRepository` vs narrower repository.

## Latihan 6 — Domain repository adapter

Buat domain repository interface. Implement dengan Jakarta Data repository di infrastructure.

## Latihan 7 — Provider-specific query

Tambahkan query native/provider-specific. Buat ADR.

## Latihan 8 — Performance

Generate banyak rows, test query with/without index, jalankan EXPLAIN.

## Latihan 9 — Concurrency

Test duplicate insert dengan unique constraint dan concurrent requests.

## Latihan 10 — Security filtering

Test repository query dengan tenant/jurisdiction filter.

---

# 47. Mini Project: Jakarta Data Repository Lab

## 47.1 Goal

Buat project:

```text
jakarta-data-repository-lab/
```

## 47.2 Modules

```text
customer-basic/
case-domain-repository/
audit-pagination/
provider-specific-search/
migration-from-jpa/
```

## 47.3 Requirements

- Jakarta EE 11 target;
- Jakarta Data 1.0 provider;
- CDI injection;
- real database via Testcontainers;
- repository integration tests;
- generated query inspection;
- performance test for pagination;
- ADR for provider-specific query.

## 47.4 Deliverables

```text
README.md
JAKARTA-DATA-MENTAL-MODEL.md
REPOSITORY-DESIGN.md
DOMAIN-VS-DATA-REPOSITORY.md
QUERY-METHODS.md
PAGINATION.md
PORTABILITY.md
PERFORMANCE-REPORT.md
FAILURE-MODES.md
```

## 47.5 Suggested entities

```text
Customer
LicenseApplication
RegulatoryCase
AuditEvent
DocumentMetadata
```

## 47.6 Evaluation questions

1. What operations does `BasicRepository` expose?
2. Why not always use `CrudRepository`?
3. What is difference between domain repository and data repository?
4. When should query method name be replaced by `@Query`?
5. Why does `-parameters` matter?
6. What makes a query non-portable?
7. Why is unbounded list dangerous?
8. When is cursor pagination better than offset?
9. How do you test generated repository implementation?
10. What still requires knowledge of underlying database?

---

# 48. Referensi Resmi

Referensi utama:

1. Jakarta Data 1.0  
   https://jakarta.ee/specifications/data/1.0/

2. Jakarta Data 1.0 Specification  
   https://jakarta.ee/specifications/data/1.0/jakarta-data-1.0

3. Jakarta Data API Docs  
   https://jakarta.ee/specifications/data/1.0/apidocs/

4. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

5. Jakarta EE Platform 11  
   https://jakarta.ee/specifications/platform/11/

6. Jakarta Persistence 3.2  
   https://jakarta.ee/specifications/persistence/3.2/

7. Jakarta CDI 4.1  
   https://jakarta.ee/specifications/cdi/4.1/

8. Jakarta Transactions 2.0  
   https://jakarta.ee/specifications/transactions/2.0/

9. Jakarta Data GitHub Project  
   https://github.com/jakartaee/data

10. Jakarta Data API `@Query` Docs  
    https://jakarta.ee/specifications/data/1.0/apidocs/jakarta.data/jakarta/data/repository/query

---

# Penutup

Jakarta Data adalah salah satu tambahan paling penting di Jakarta EE 11 karena ia membawa standard repository abstraction ke Jakarta ecosystem.

Namun mental model yang benar sangat penting:

```text
Jakarta Data is a repository programming model.
It is not a database replacement.
It is not a domain model replacement.
It is not a guarantee that every datastore behaves the same.
```

Gunakan Jakarta Data untuk:

- common CRUD;
- simple query;
- pagination/sorting;
- repository interface standardization;
- productivity.

Tetap gunakan JPA/provider-specific/explicit repository untuk:

- complex query;
- performance-critical path;
- locking;
- bulk operation;
- custom projection;
- advanced database feature;
- domain aggregate persistence.

Prinsip paling penting:

> Repository abstraction should reduce boilerplate, not hide architecture.

Engineer top-tier tidak hanya menulis `findByStatusAndCreatedAtBetween`. Ia tahu query apa yang dihasilkan, index apa yang dibutuhkan, transaction boundary di mana, apakah method portable, dan apakah repository tersebut merepresentasikan data access atau domain contract.

Bagian berikutnya akan membahas **Jakarta Transactions (`jakarta.transaction`)**, yaitu fondasi yang menentukan consistency boundary, rollback, propagation, timeout, XA, dan kapan memilih outbox/saga daripada distributed transaction.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 12 — Jakarta Persistence (`jakarta.persistence`) / JPA](./learn-java-jakarta-part-012.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 14 — Jakarta Transactions: Transaction Boundary, Rollback, XA, dan Consistency Engineering](./learn-java-jakarta-part-014.md)
