# learn-java-jakarta-part-001.md

# Bagian 1 — Namespace Migration: `javax.*` ke `jakarta.*`

> Target pembaca: Java engineer yang sudah memahami Java SE, dependency management, framework dasar, dan sekarang ingin memahami migrasi `javax.*` ke `jakarta.*` secara mendalam—bukan hanya melakukan search-replace import.
>
> Target hasil: kamu mampu membaca, merencanakan, mengeksekusi, men-debug, dan mereview migrasi Java EE / Jakarta EE 8 / Spring Boot 2.x / aplikasi legacy `javax.*` menuju Jakarta EE modern / Spring Boot 3+ / runtime berbasis `jakarta.*` dengan risiko terkontrol.

---

## Daftar Isi

1. [Orientasi: Kenapa Bagian Ini Penting](#1-orientasi-kenapa-bagian-ini-penting)
2. [Mental Model: Namespace Migration Bukan Sekadar Rename Import](#2-mental-model-namespace-migration-bukan-sekadar-rename-import)
3. [Sejarah Singkat: Java EE, Eclipse Foundation, dan Jakarta EE](#3-sejarah-singkat-java-ee-eclipse-foundation-dan-jakarta-ee)
4. [Apa yang Berubah di Jakarta EE 9](#4-apa-yang-berubah-di-jakarta-ee-9)
5. [Package Mana yang Berubah dan Mana yang Tidak](#5-package-mana-yang-berubah-dan-mana-yang-tidak)
6. [Kenapa Blind Replace `javax` ke `jakarta` Berbahaya](#6-kenapa-blind-replace-javax-ke-jakarta-berbahaya)
7. [Layer yang Terdampak Migrasi](#7-layer-yang-terdampak-migrasi)
8. [Compile-Time vs Runtime vs Deployment-Time Failure](#8-compile-time-vs-runtime-vs-deployment-time-failure)
9. [Dependency Graph dan Classpath Conflict](#9-dependency-graph-dan-classpath-conflict)
10. [API Jar, Implementation Jar, dan Container Runtime](#10-api-jar-implementation-jar-dan-container-runtime)
11. [Migration Path Umum](#11-migration-path-umum)
12. [Strategi Migrasi Source Code](#12-strategi-migrasi-source-code)
13. [Strategi Migrasi Dependency Maven/Gradle](#13-strategi-migrasi-dependency-mavengradle)
14. [Strategi Migrasi Configuration Files](#14-strategi-migrasi-configuration-files)
15. [Strategi Migrasi Binary Artifact](#15-strategi-migrasi-binary-artifact)
16. [Tools: OpenRewrite, Eclipse Transformer, Tomcat Migration Tool](#16-tools-openrewrite-eclipse-transformer-tomcat-migration-tool)
17. [Spring Boot 2 ke Spring Boot 3 sebagai Studi Kasus](#17-spring-boot-2-ke-spring-boot-3-sebagai-studi-kasus)
18. [Jakarta EE Runtime sebagai Studi Kasus](#18-jakarta-ee-runtime-sebagai-studi-kasus)
19. [JPA/Hibernate Migration Notes](#19-jpahibernate-migration-notes)
20. [Servlet/JAX-RS/Validation/JAXB/JMS Migration Notes](#20-servletjax-rsvalidationjaxbjms-migration-notes)
21. [Testing Strategy](#21-testing-strategy)
22. [Production Rollout Strategy](#22-production-rollout-strategy)
23. [Common Failure Modes dan Diagnosis](#23-common-failure-modes-dan-diagnosis)
24. [Migration Checklist](#24-migration-checklist)
25. [Latihan Bertahap](#25-latihan-bertahap)
26. [Mini Project: Migrasi Legacy `javax` Service ke `jakarta`](#26-mini-project-migrasi-legacy-javax-service-ke-jakarta)
27. [Referensi Resmi](#27-referensi-resmi)

---

# 1. Orientasi: Kenapa Bagian Ini Penting

Migrasi `javax.*` ke `jakarta.*` adalah salah satu perubahan terbesar dalam ekosistem enterprise Java modern.

Di permukaan, kelihatannya sederhana:

```java
import javax.persistence.Entity;
```

menjadi:

```java
import jakarta.persistence.Entity;
```

Tetapi dalam production system, perubahan ini menyentuh:

- source code;
- generated code;
- dependency tree;
- annotation processor;
- bytecode library;
- framework version;
- application server/runtime;
- servlet container;
- JPA provider;
- Bean Validation provider;
- JSON/XML binding;
- configuration file;
- JSP/TLD;
- deployment descriptor;
- test framework;
- APM/agent;
- third-party libraries;
- transitive dependencies;
- binary artifacts;
- CI/CD image;
- rollback compatibility.

Itulah sebabnya migrasi ini tidak boleh dianggap sebagai “rename package”.

## 1.1 Perubahan namespace adalah perubahan ekosistem

`javax.*` dan `jakarta.*` bukan dua nama import yang interchangeable. Mereka adalah dua dunia dependency yang berbeda.

Jika satu library dikompilasi terhadap:

```java
javax.servlet.http.HttpServletRequest
```

sementara runtime menyediakan:

```java
jakarta.servlet.http.HttpServletRequest
```

maka class tersebut tidak kompatibel secara binary. JVM melihat keduanya sebagai type yang berbeda.

```text
javax.servlet.http.HttpServletRequest
!=
jakarta.servlet.http.HttpServletRequest
```

Walaupun nama class akhirnya sama-sama `HttpServletRequest`, fully qualified name berbeda, sehingga type identity berbeda.

## 1.2 Masalah terbesar: campuran ekosistem

Migrasi gagal paling sering karena dependency graph campur:

```text
application code uses jakarta.*
  but library A expects javax.*
  but library B exposes jakarta.*
  but container is Jakarta EE 10
  but old transitive dependency still uses Java EE 8 API
```

Atau sebaliknya:

```text
application code masih javax.*
  tetapi runtime Tomcat 10 only supports jakarta.servlet.*
```

Hasilnya:

```text
ClassNotFoundException
NoClassDefFoundError
ClassCastException
NoSuchMethodError
LinkageError
UnsatisfiedDependencyException
BeanCreationException
IllegalArgumentException: Not a managed type
```

## 1.3 Target mental model

Setelah bagian ini, kamu harus bisa berpikir seperti ini:

```text
Migrasi javax → jakarta adalah alignment problem:

source code namespace
+ API dependency namespace
+ implementation dependency namespace
+ runtime/container namespace
+ generated code namespace
+ config/resource namespace
+ third-party library namespace
+ test/runtime namespace

semuanya harus konsisten.
```

---

# 2. Mental Model: Namespace Migration Bukan Sekadar Rename Import

## 2.1 Type identity di JVM

Di Java, class ditentukan oleh:

```text
fully qualified class name + defining classloader
```

Jadi:

```java
javax.persistence.Entity
```

berbeda total dengan:

```java
jakarta.persistence.Entity
```

Begitu juga:

```java
javax.validation.Valid
```

berbeda dengan:

```java
jakarta.validation.Valid
```

Framework yang mencari annotation `jakarta.persistence.Entity` tidak otomatis mengenali `javax.persistence.Entity`.

Contoh:

```java
import javax.persistence.Entity;

@Entity
public class CaseEntity {}
```

Jika Hibernate/JPA provider modern mencari:

```java
jakarta.persistence.Entity
```

maka class di atas bisa dianggap bukan entity.

## 2.2 Namespace is part of contract

Namespace ada di banyak tempat:

```text
source import
class file constant pool
annotation descriptor
method signature
field signature
generic signature
configuration file
JSP/TLD
XML descriptor
service loader file
reflection string
serialized data
OpenAPI schema generated types
```

Jadi migrasi harus mencari lebih dari import statement.

Contoh string-based reflection:

```java
Class.forName("javax.xml.bind.JAXBContext");
```

Search-replace import tidak menyentuh string ini jika tidak hati-hati.

## 2.3 Compile success tidak cukup

Aplikasi bisa compile tapi gagal saat runtime.

Contoh:

```java
// code sudah jakarta.*
import jakarta.servlet.Filter;
```

Tetapi dependency lama masih membawa class yang butuh:

```java
javax.servlet.Filter
```

Compile aplikasi sukses, tetapi runtime gagal saat library lama diload.

## 2.4 Runtime success lokal tidak cukup

Aplikasi bisa jalan di lokal embedded server, tapi gagal di server production.

Contoh:

```text
Local: Spring Boot embedded Tomcat 10, jakarta.* OK
Production: external Tomcat 9, only javax.servlet.*
```

Atau:

```text
Local: WildFly Jakarta EE 10
Production: old Java EE 8 server
```

Runtime/container harus ikut dimigrasikan.

## 2.5 Migration is alignment

Gunakan model ini:

```text
┌────────────────────────────┐
│ Source Code Namespace       │ javax or jakarta
├────────────────────────────┤
│ API Dependencies            │ javax or jakarta
├────────────────────────────┤
│ Implementation Libraries    │ javax or jakarta
├────────────────────────────┤
│ Runtime / Container         │ javax or jakarta
├────────────────────────────┤
│ Config / XML / JSP / TLD    │ javax or jakarta
├────────────────────────────┤
│ Generated Code              │ javax or jakarta
├────────────────────────────┤
│ Test Runtime                │ javax or jakarta
├────────────────────────────┤
│ Third-party Libraries       │ javax or jakarta
└────────────────────────────┘
```

Jika satu layer berbeda, failure mungkin muncul.

---

# 3. Sejarah Singkat: Java EE, Eclipse Foundation, dan Jakarta EE

## 3.1 Dari J2EE ke Java EE

Enterprise Java awalnya dikenal sebagai J2EE. Kemudian namanya menjadi Java EE.

Java EE menyediakan standard APIs untuk enterprise application:

- Servlet;
- JSP;
- JSF;
- JPA;
- EJB;
- JTA;
- JMS;
- CDI;
- Bean Validation;
- JAX-RS;
- JAXB;
- JAX-WS;
- dan lain-lain.

Namespace historisnya memakai:

```text
javax.*
```

Contoh:

```java
javax.servlet.Servlet
javax.persistence.Entity
javax.ws.rs.Path
javax.validation.Valid
javax.transaction.Transactional
```

## 3.2 Java EE pindah ke Eclipse Foundation

Setelah stewardship Java EE berpindah ke Eclipse Foundation, platform enterprise Java berevolusi menjadi Jakarta EE.

Nama “Java” dan namespace `javax` memiliki batasan hak/trademark, sehingga evolusi spesifikasi di bawah Eclipse Foundation tidak bisa terus menggunakan namespace lama untuk perubahan major berikutnya.

Akibatnya, Jakarta EE memperkenalkan namespace baru:

```text
jakarta.*
```

## 3.3 Jakarta EE 8

Jakarta EE 8 adalah tahap transisi yang masih memakai namespace lama:

```text
javax.*
```

Secara praktis, Jakarta EE 8 sangat dekat dengan Java EE 8 dari sisi API namespace.

## 3.4 Jakarta EE 9

Jakarta EE 9 adalah release namespace migration.

Tujuan utamanya:

```text
javax.* → jakarta.*
```

Jakarta EE 9 sengaja menjadi bridge release agar ecosystem dapat berpindah namespace.

Artinya, Jakarta EE 9 bukan terutama tentang fitur besar baru, tetapi tentang memindahkan API dan ecosystem ke namespace baru.

## 3.5 Jakarta EE 9.1

Jakarta EE 9.1 melanjutkan Jakarta EE 9 dan fokus pada compatibility dengan Java SE 11.

## 3.6 Jakarta EE 10 dan 11

Jakarta EE 10 dan 11 mulai membawa evolusi fitur dan modernisasi lebih nyata.

Jakarta EE 11 menjadi baseline modern penting karena membawa peningkatan di area seperti:

- dukungan Java modern;
- records support di beberapa spesifikasi;
- runtime-aware virtual thread support;
- Jakarta Data;
- profile modernization;
- minimum Java SE baseline yang lebih modern pada profile tertentu.

## 3.7 Implikasi besar

Satu hal penting:

```text
Jakarta EE 8 = javax.*
Jakarta EE 9+ = jakarta.*
```

Jadi migration boundary bukan sekadar:

```text
Java EE → Jakarta EE
```

Tetapi lebih akurat:

```text
Java EE / Jakarta EE 8 namespace javax
  → Jakarta EE 9+ namespace jakarta
```

---

# 4. Apa yang Berubah di Jakarta EE 9

## 4.1 Perubahan utama

Jakarta EE 9 mengubah namespace API enterprise dari:

```text
javax.*
```

menjadi:

```text
jakarta.*
```

Contoh:

```java
javax.servlet.http.HttpServletRequest
```

menjadi:

```java
jakarta.servlet.http.HttpServletRequest
```

```java
javax.persistence.Entity
```

menjadi:

```java
jakarta.persistence.Entity
```

```java
javax.ws.rs.Path
```

menjadi:

```java
jakarta.ws.rs.Path
```

## 4.2 Yang berubah bukan hanya application code

Jakarta EE 9 namespace change memengaruhi:

- specification documents;
- API source;
- API Javadocs;
- TCK;
- compatible implementations;
- application source;
- build dependencies;
- config descriptors;
- runtime container;
- third-party libraries.

Artinya runtime dan tools juga harus migrasi.

## 4.3 Ada spesifikasi yang dihapus dari Platform

Jakarta EE 9 juga mengurangi surface area platform dengan menghapus spesifikasi lama/opsional/deprecated tertentu dari platform. Tujuannya membuat platform lebih ramping dan lebih mudah diimplementasikan vendor baru.

Implikasi:

```text
Migrasi ke Jakarta EE 9+ bukan hanya rename package; cek juga apakah spesifikasi lama yang dipakai masih ada di target platform/runtime.
```

## 4.4 Migration impact ke application server

Jika aplikasi lama Java EE 8 deploy ke server Jakarta EE 9+ tanpa transformasi, bisa gagal karena server mencari `jakarta.*` API.

Sebaliknya, aplikasi `jakarta.*` tidak bisa dideploy ke server Java EE 8/Jakarta EE 8 yang hanya menyediakan `javax.*`.

## 4.5 Migration impact ke libraries

Library harus memilih target:

```text
javax variant
or
jakarta variant
```

Beberapa library menyediakan versi berbeda:

```text
library 1.x → javax
library 2.x → jakarta
```

Beberapa memakai artifact berbeda.

Beberapa belum support Jakarta.

Beberapa support keduanya melalui multi-release/build variant, tetapi ini tidak universal.

---

# 5. Package Mana yang Berubah dan Mana yang Tidak

## 5.1 Package Jakarta EE yang berubah

Banyak package enterprise berubah dari `javax.*` ke `jakarta.*`.

Contoh umum:

| Lama | Baru |
|---|---|
| `javax.annotation` | `jakarta.annotation` |
| `javax.inject` | `jakarta.inject` |
| `javax.enterprise` | `jakarta.enterprise` |
| `javax.interceptor` | `jakarta.interceptor` |
| `javax.servlet` | `jakarta.servlet` |
| `javax.ws.rs` | `jakarta.ws.rs` |
| `javax.json` | `jakarta.json` |
| `javax.json.bind` | `jakarta.json.bind` |
| `javax.persistence` | `jakarta.persistence` |
| `javax.transaction` | `jakarta.transaction` |
| `javax.validation` | `jakarta.validation` |
| `javax.security.enterprise` | `jakarta.security.enterprise` |
| `javax.websocket` | `jakarta.websocket` |
| `javax.jms` | `jakarta.jms` |
| `javax.ejb` | `jakarta.ejb` |
| `javax.batch` | `jakarta.batch` |
| `javax.mail` | `jakarta.mail` |
| `javax.activation` | `jakarta.activation` |
| `javax.xml.bind` | `jakarta.xml.bind` |
| `javax.xml.ws` | `jakarta.xml.ws` |
| `javax.resource` | `jakarta.resource` |

## 5.2 Package Java SE yang tetap `javax.*`

Tidak semua `javax.*` berubah.

Beberapa `javax.*` adalah bagian dari Java SE dan tetap bernama `javax.*`.

Contoh penting:

```java
javax.crypto.*
javax.net.*
javax.net.ssl.*
javax.sql.*
javax.management.*
javax.naming.*
javax.xml.parsers.*
javax.xml.transform.*
javax.xml.validation.*
javax.xml.xpath.*
javax.security.auth.*
javax.security.cert.*
```

Jadi jangan lakukan:

```text
replace all "javax." with "jakarta."
```

Karena kamu bisa merusak code valid seperti:

```java
import javax.crypto.Cipher;
import javax.net.ssl.SSLContext;
import javax.sql.DataSource;
```

## 5.3 Package yang tampak mirip tetapi berbeda domain

Contoh:

```java
javax.xml.parsers.DocumentBuilderFactory
```

Ini Java SE XML parser API, bukan JAXB.

Sedangkan:

```java
javax.xml.bind.JAXBContext
```

adalah JAXB enterprise/XML binding API yang berubah ke:

```java
jakarta.xml.bind.JAXBContext
```

## 5.4 Rule praktis

Gunakan rule:

```text
Jika package adalah Jakarta EE specification → migrate to jakarta.*
Jika package adalah Java SE standard API → tetap javax.*
```

Tetapi jangan rely pada ingatan. Verifikasi dengan:

- Jakarta EE specification docs;
- Java SE API docs;
- dependency documentation;
- compiler;
- IDE refactoring;
- static analysis.

---

# 6. Kenapa Blind Replace `javax` ke `jakarta` Berbahaya

## 6.1 Merusak Java SE APIs

Blind replace:

```java
import javax.net.ssl.SSLContext;
```

menjadi:

```java
import jakarta.net.ssl.SSLContext;
```

Ini salah. Package `jakarta.net.ssl` tidak ada.

## 6.2 Merusak `javax.sql.DataSource`

Banyak aplikasi enterprise tetap memakai:

```java
javax.sql.DataSource
```

Itu Java SE API dan tetap benar.

Blind replace menjadi:

```java
jakarta.sql.DataSource
```

akan gagal.

## 6.3 Merusak XML parser Java SE

```java
javax.xml.parsers.DocumentBuilderFactory
javax.xml.transform.TransformerFactory
javax.xml.validation.SchemaFactory
```

Tetap Java SE.

Jangan diganti.

## 6.4 Merusak security/crypto

```java
javax.crypto.Cipher
javax.net.ssl.TrustManager
javax.security.auth.Subject
```

Tetap Java SE/security API.

## 6.5 Tidak menyentuh binary artifacts

Blind replace source tidak mengubah:

- compiled `.class` dalam dependency jar;
- transitive dependency;
- JSP compiled artifacts;
- generated classes;
- shaded libraries;
- XML descriptors di dependency;
- annotation descriptor dalam class file.

## 6.6 Tidak menyentuh semantic change

Contoh:

```text
Spring Boot 2 → 3
```

bukan hanya `javax → jakarta`, tetapi juga:

- Spring Framework 5 → 6;
- Hibernate 5 → 6;
- Java baseline 8/11 → 17+;
- changed APIs;
- changed configuration;
- changed behavior.

## 6.7 Cara yang benar

Gunakan targeted migration:

1. Identifikasi Jakarta EE packages.
2. Upgrade dependencies ke versi Jakarta-compatible.
3. Jalankan automated migration tool.
4. Review diff.
5. Compile.
6. Fix source/config.
7. Run tests.
8. Run integration tests.
9. Inspect dependency tree.
10. Deploy ke runtime Jakarta-compatible.

---

# 7. Layer yang Terdampak Migrasi

## 7.1 Source imports

Contoh:

```java
import javax.validation.Valid;
import javax.ws.rs.Path;
import javax.persistence.Entity;
```

menjadi:

```java
import jakarta.validation.Valid;
import jakarta.ws.rs.Path;
import jakarta.persistence.Entity;
```

## 7.2 Annotation descriptors di bytecode

Annotation disimpan di class file dengan descriptor.

```text
Ljavax/persistence/Entity;
```

berbeda dari:

```text
Ljakarta/persistence/Entity;
```

Framework membaca descriptor ini.

## 7.3 Maven/Gradle dependencies

Old:

```xml
<dependency>
  <groupId>javax.persistence</groupId>
  <artifactId>javax.persistence-api</artifactId>
</dependency>
```

New:

```xml
<dependency>
  <groupId>jakarta.persistence</groupId>
  <artifactId>jakarta.persistence-api</artifactId>
</dependency>
```

Atau via platform API:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 7.4 Framework dependencies

Examples:

```text
Spring Framework 5.x → javax-era
Spring Framework 6.x → jakarta-era
Spring Boot 2.x → javax-era
Spring Boot 3.x → jakarta-era
Hibernate 5.x → javax persistence era
Hibernate 6.x/7.x → jakarta persistence era
Tomcat 9 → javax servlet
Tomcat 10+ → jakarta servlet
```

## 7.5 Configuration files

Descriptors may reference old namespaces/classes:

- `web.xml`;
- `persistence.xml`;
- `beans.xml`;
- `faces-config.xml`;
- `validation.xml`;
- `orm.xml`;
- JSP taglibs;
- TLD files;
- service loader metadata;
- properties files;
- XML schema locations.

## 7.6 Generated source

Generated code from:

- JAXB;
- JAX-WS;
- OpenAPI generator;
- QueryDSL;
- annotation processors;
- legacy code generators;
- IDE tools;
- WSDL tools.

must also target `jakarta.*` if runtime is Jakarta.

## 7.7 Tests

Tests may use:

```java
javax.servlet.*
javax.validation.*
javax.persistence.*
```

Test libraries also must be upgraded:

- MockMvc/Spring Test;
- Mockito/Byte Buddy;
- Arquillian;
- Testcontainers runtime image;
- REST-assured;
- Jersey client/server;
- Weld/CDI testing.

## 7.8 Deployment runtime

Runtime must match:

| Runtime | Namespace |
|---|---|
| Tomcat 9 | `javax.servlet.*` |
| Tomcat 10+ | `jakarta.servlet.*` |
| Spring Boot 2.x embedded Tomcat | usually `javax` era |
| Spring Boot 3.x embedded Tomcat | `jakarta` era |
| Jakarta EE 8 runtime | `javax` |
| Jakarta EE 9+ runtime | `jakarta` |

## 7.9 APM/agents

Bytecode instrumentation agents may match class names.

If agent instruments:

```text
javax.servlet.Filter
```

but app uses:

```text
jakarta.servlet.Filter
```

instrumentation may fail or be incomplete unless agent supports Jakarta namespace.

---

# 8. Compile-Time vs Runtime vs Deployment-Time Failure

## 8.1 Compile-time failure

Example:

```text
package javax.persistence does not exist
```

Cause:

- dependency changed;
- source still uses old import;
- API jar missing;
- wrong Maven scope;
- generated source still old namespace.

Fix:

- update imports;
- update generated source;
- add correct `jakarta.*` API dependency;
- regenerate code.

## 8.2 Runtime class loading failure

Example:

```text
java.lang.NoClassDefFoundError: javax/servlet/Filter
```

Cause:

- some library compiled against `javax.servlet`;
- runtime only provides `jakarta.servlet`;
- transitive dependency not migrated.

Fix:

- upgrade offending library;
- replace library;
- use artifact variant for Jakarta;
- transform binary only as controlled temporary strategy.

## 8.3 Runtime type mismatch

Example:

```text
ClassCastException: jakarta.servlet.http.HttpServletRequest cannot be cast to javax.servlet.http.HttpServletRequest
```

Cause:

- mixing `javax` and `jakarta` types;
- adapter/library boundary mismatch.

Fix:

- align all layers to one namespace;
- do not bridge directly by casting;
- use runtime-compatible versions.

## 8.4 Annotation not detected

Example:

```java
import javax.persistence.Entity;

@Entity
public class CaseEntity {}
```

with Jakarta Hibernate provider expecting `jakarta.persistence.Entity`.

Symptom:

```text
Not a managed type
```

Fix:

```java
import jakarta.persistence.Entity;
```

and ensure dependency/runtime align.

## 8.5 Deployment failure

Example:

```text
Application built for jakarta.servlet deployed to Tomcat 9
```

Tomcat 9 does not provide Jakarta Servlet 5/6 APIs.

Fix:

- deploy to Tomcat 10+;
- or keep app on `javax.servlet` for Tomcat 9;
- don't mix.

## 8.6 Behavior failure

App starts, tests pass, but behavior changes.

Examples:

- validation messages differ;
- Hibernate query behavior changed;
- JSON binding behavior changed;
- servlet container default behavior changed;
- transaction rollback rules changed due to framework upgrade;
- date/time serialization changed;
- lazy loading behavior changed.

Fix:

- contract tests;
- integration tests;
- golden output tests;
- performance regression tests.

---

# 9. Dependency Graph dan Classpath Conflict

## 9.1 Dependency graph adalah medan perang utama

Migrasi namespace gagal jika dependency graph campur.

Contoh Maven tree:

```text
com.example:case-service
+- org.springframework.boot:spring-boot-starter-web:3.x
|  +- jakarta.servlet:jakarta.servlet-api
+- com.old.vendor:legacy-auth-filter:1.2
|  +- javax.servlet:javax.servlet-api
```

`legacy-auth-filter` masih `javax`.

## 9.2 Cara memeriksa Maven

```bash
mvn dependency:tree
mvn dependency:tree -Dincludes=javax.*
mvn dependency:tree -Dincludes=jakarta.*
```

Gunakan juga:

```bash
mvn dependency:tree -Dverbose
```

jika butuh melihat conflict/omission.

## 9.3 Cara memeriksa Gradle

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency javax.servlet
./gradlew dependencyInsight --dependency jakarta.servlet
```

## 9.4 Ciri dependency conflict

- ada `javax.*-api` dan `jakarta.*-api` sekaligus untuk spec sejenis;
- servlet API lama dan baru muncul bersama;
- Hibernate/JPA provider tidak cocok dengan API;
- validation API lama dan provider baru atau sebaliknya;
- JAXB API lama dan implementation baru tidak match;
- Spring Boot starter versi campur;
- app server menyediakan API tetapi app juga membundel API yang berbeda.

## 9.5 Dependency convergence

Gunakan BOM/platform dependency.

Maven:

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>jakarta.platform</groupId>
      <artifactId>jakarta.jakartaee-bom</artifactId>
      <version>11.0.0</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

Atau gunakan runtime/framework BOM seperti Spring Boot BOM jika memakai Spring Boot.

## 9.6 Jangan paksa versi acak

Jangan sekadar override dependency karena compile error.

Buruk:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
  <version>6.1.0</version>
</dependency>
```

sementara runtime container hanya Servlet 5.

Version API harus match runtime/framework.

---

# 10. API Jar, Implementation Jar, dan Container Runtime

## 10.1 API jar hanya contract

Contoh:

```xml
<dependency>
  <groupId>jakarta.persistence</groupId>
  <artifactId>jakarta.persistence-api</artifactId>
</dependency>
```

Ini hanya API:

```java
jakarta.persistence.Entity
jakarta.persistence.EntityManager
```

Tidak menyediakan implementation ORM.

Kamu tetap butuh:

- Hibernate;
- EclipseLink;
- atau JPA provider dari Jakarta EE runtime.

## 10.2 Provided scope

Jika deploy ke Jakarta EE runtime, API biasanya provided by container.

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

Artinya:

```text
compile against API
but do not package it into deployment artifact
runtime/container provides it
```

## 10.3 Spring Boot executable jar berbeda

Spring Boot fat jar biasanya membawa implementation sendiri:

- embedded Tomcat/Jetty/Undertow;
- Hibernate;
- Validator;
- Jackson;
- etc.

Maka dependency strategy mengikuti Spring Boot BOM, bukan full Jakarta EE runtime.

## 10.4 WAR deployment vs executable jar

### WAR to external container

```text
container provides servlet/Jakarta APIs
application should not bundle conflicting APIs
```

### Executable jar

```text
application bundles embedded server and implementation libraries
```

## 10.5 Common mistake

Menambahkan API jar sebagai runtime dependency ke WAR:

```xml
<scope>compile</scope>
```

Padahal server juga menyediakan API.

Risiko:

- duplicate classes;
- classloader conflict;
- version mismatch;
- weird runtime errors.

---

# 11. Migration Path Umum

## 11.1 Path A — Java EE 8 / Jakarta EE 8 application server ke Jakarta EE 10/11

```text
Java EE 8 / Jakarta EE 8
  javax.*
  Java 8/11
  old app server

→ update source/config/dependencies
→ update runtime to Jakarta EE 10/11-compatible
→ test behavior
```

Use case:

- WAR/EAR legacy;
- EJB/JPA/JAX-RS/CDI;
- external server such as older GlassFish/WildFly/Payara/Open Liberty.

## 11.2 Path B — Spring Boot 2.x ke Spring Boot 3.x

```text
Spring Boot 2.x
  Spring Framework 5.x
  Java 8/11/17
  javax.* era

→ Spring Boot 2.7 latest
→ Java 17 baseline
→ Spring Boot 3.x
→ jakarta.* namespace
```

Use case:

- Spring MVC/Servlet;
- Spring Data JPA;
- Bean Validation;
- old `javax.persistence`;
- old `javax.validation`.

## 11.3 Path C — Library migration

If you maintain library:

Options:

1. release separate `javax` and `jakarta` artifacts;
2. major version bump for Jakarta;
3. transform artifact;
4. keep framework-neutral API;
5. avoid exposing Jakarta types in public API if portability desired.

## 11.4 Path D — Binary transformation temporary bridge

Use tools to transform compiled artifact.

Good for:

- third-party library no longer maintained;
- short-term migration bridge;
- controlled internal artifact;
- WAR transformation for app server migration.

Risk:

- not source-of-truth;
- debugging harder;
- legal/license review needed;
- hidden resource strings;
- behavior not guaranteed;
- should not be permanent unless owned.

## 11.5 Path E — Strangler migration

For large monolith:

```text
keep legacy javax app running
extract new module/service in jakarta stack
bridge via API/events
migrate feature by feature
```

This avoids one giant migration.

---

# 12. Strategi Migrasi Source Code

## 12.1 Make migration branch small and reviewable

Do not mix:

- namespace migration;
- business feature;
- domain refactor;
- database redesign;
- formatter change;
- Java version upgrade;
- framework major upgrade;
- performance optimization.

If possible, separate PRs:

1. update dependencies;
2. namespace migration;
3. config migration;
4. test fixes;
5. runtime upgrade;
6. cleanup.

## 12.2 Search targets

Search for:

```text
javax.annotation
javax.inject
javax.enterprise
javax.interceptor
javax.servlet
javax.ws.rs
javax.json
javax.json.bind
javax.persistence
javax.transaction
javax.validation
javax.security.enterprise
javax.websocket
javax.jms
javax.ejb
javax.batch
javax.mail
javax.activation
javax.xml.bind
javax.xml.ws
javax.resource
```

Do not search only `import javax`.

Also search:

```text
"javax."
Ljavax/
javax/
```

## 12.3 Reflection strings

Example:

```java
Class.forName("javax.servlet.Filter");
```

must become:

```java
Class.forName("jakarta.servlet.Filter");
```

if target runtime is Jakarta.

## 12.4 Annotation names in config

Example XML/properties:

```xml
<provider>javax.persistence.spi.PersistenceProvider</provider>
```

or:

```properties
factory.class=javax.xml.bind.JAXBContext
```

Need migration.

## 12.5 Generated source

If generated source contains old namespace, fix generator config rather than manually editing generated files.

Examples:

- OpenAPI generator options;
- JAXB/JAX-WS plugin version;
- annotation processor version;
- QueryDSL Jakarta classifier/version;
- codegen templates.

## 12.6 Public API compatibility

If your library public API exposes `javax` types:

```java
public void registerFilter(javax.servlet.Filter filter)
```

migration to:

```java
public void registerFilter(jakarta.servlet.Filter filter)
```

is a breaking API change.

Major version bump is appropriate.

## 12.7 Binary compatibility impossible across renamed type

A method signature containing `javax` cannot be binary compatible with the same-looking `jakarta` signature.

```java
void validate(javax.validation.Validator v)
```

and:

```java
void validate(jakarta.validation.Validator v)
```

are different descriptors.

---

# 13. Strategi Migrasi Dependency Maven/Gradle

## 13.1 Maven: identify API dependencies

Old examples:

```xml
<dependency>
  <groupId>javax.servlet</groupId>
  <artifactId>javax.servlet-api</artifactId>
</dependency>

<dependency>
  <groupId>javax.persistence</groupId>
  <artifactId>javax.persistence-api</artifactId>
</dependency>

<dependency>
  <groupId>javax.validation</groupId>
  <artifactId>validation-api</artifactId>
</dependency>
```

New examples:

```xml
<dependency>
  <groupId>jakarta.servlet</groupId>
  <artifactId>jakarta.servlet-api</artifactId>
</dependency>

<dependency>
  <groupId>jakarta.persistence</groupId>
  <artifactId>jakarta.persistence-api</artifactId>
</dependency>

<dependency>
  <groupId>jakarta.validation</groupId>
  <artifactId>jakarta.validation-api</artifactId>
</dependency>
```

## 13.2 Prefer BOM

For Jakarta EE runtime:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

For Web Profile:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-web-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

For Core Profile:

```xml
<dependency>
  <groupId>jakarta.platform</groupId>
  <artifactId>jakarta.jakartaee-core-api</artifactId>
  <version>11.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 13.3 Spring Boot dependency strategy

If using Spring Boot:

```xml
<parent>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-parent</artifactId>
  <version>3.x.x</version>
</parent>
```

Let Spring Boot BOM manage:

- Servlet API;
- Tomcat/Jetty/Undertow;
- Hibernate;
- Validator;
- Jackson;
- etc.

Do not manually override unless needed and tested.

## 13.4 Gradle version catalog

Example:

```toml
[versions]
jakarta-servlet = "6.1.0"
jakarta-persistence = "3.2.0"

[libraries]
jakarta-servlet-api = { module = "jakarta.servlet:jakarta.servlet-api", version.ref = "jakarta-servlet" }
jakarta-persistence-api = { module = "jakarta.persistence:jakarta.persistence-api", version.ref = "jakarta-persistence" }
```

But again, if using framework BOM, prefer platform alignment.

## 13.5 Exclude old javax dependencies

If old transitive dependency brings `javax` API, you may need:

```xml
<exclusions>
  <exclusion>
    <groupId>javax.servlet</groupId>
    <artifactId>javax.servlet-api</artifactId>
  </exclusion>
</exclusions>
```

But exclusion alone is not enough if the library bytecode still references `javax.servlet.*`.

If bytecode references old types, upgrade/replace/transform library.

## 13.6 Artifact variants

Some libraries offer Jakarta variants.

Patterns vary:

```text
artifact-jakarta
artifact with classifier jakarta
major version uses jakarta
separate group/artifact
```

Always check library docs.

---

# 14. Strategi Migrasi Configuration Files

## 14.1 `web.xml`

Old servlet namespace/classes may appear.

Search:

```text
javax.servlet
javax.faces
javax.ws.rs
```

Also check XML schema version.

## 14.2 `persistence.xml`

Old:

```xml
<persistence xmlns="http://xmlns.jcp.org/xml/ns/persistence"
             version="2.2">
```

Jakarta versions use Jakarta namespace/schema locations depending target version.

Also check provider class names.

## 14.3 `beans.xml`

CDI descriptors may need updated namespace/version.

## 14.4 `validation.xml`

Bean Validation config may reference old package names and XML namespace.

## 14.5 JSP/TLD

JSP pages may include taglib URIs or class references.

Migration tools often handle JSP/TLD better than manual import replace.

## 14.6 Properties/YAML

Search:

```text
javax.
```

in:

- `application.properties`;
- `application.yaml`;
- `persistence.properties`;
- custom configuration;
- system property defaults;
- framework config.

## 14.7 ServiceLoader files

Check:

```text
META-INF/services/*
```

A service provider file may contain old interface name.

Example:

```text
META-INF/services/javax.ws.rs.ext.RuntimeDelegate
```

must align with target namespace.

---

# 15. Strategi Migrasi Binary Artifact

## 15.1 Why binary transformation exists

Sometimes source code is unavailable or too expensive to migrate immediately.

Binary transformation tools can rewrite:

- `.class` constant pool references;
- JAR/WAR/EAR contents;
- config resources;
- service descriptors;
- JSP/TLD references;
- string constants in certain cases.

## 15.2 When acceptable

Binary transformation can be acceptable when:

- artifact is internal;
- source migration is scheduled later;
- transformation is automated and reproducible;
- tests verify behavior;
- license allows transformation;
- ownership is clear;
- rollback exists.

## 15.3 When dangerous

Dangerous when:

- artifact has complex reflection;
- native code involved;
- serialized class names persist;
- string names are dynamic/encrypted/compressed;
- vendor does not support transformed artifact;
- no integration tests;
- transformation is manual.

## 15.4 Treat transformed binary as generated artifact

Do not manually modify transformed artifact.

Pipeline:

```text
source artifact
  → transformer with config
  → transformed artifact
  → test
  → publish to internal repository
```

Record metadata:

```text
original artifact version
transformer version
rules version
date
owner
```

---

# 16. Tools: OpenRewrite, Eclipse Transformer, Tomcat Migration Tool

## 16.1 OpenRewrite

OpenRewrite provides recipes for source/build migration.

Use cases:

- change imports;
- update Maven/Gradle dependencies;
- migrate Spring Boot 2 → 3 patterns;
- update deprecated APIs;
- apply consistent refactoring across many repos.

Conceptual usage:

```bash
mvn org.openrewrite.maven:rewrite-maven-plugin:run \
  -Drewrite.activeRecipes=org.openrewrite.java.migrate.jakarta.JavaxMigrationToJakarta
```

Always review generated diff.

## 16.2 Eclipse Transformer

Eclipse Transformer can transform Java binaries and resources by applying package/type/resource renaming rules.

Use cases:

- transform JAR/WAR;
- transform third-party/internal artifact;
- bridge binary migration;
- test migration feasibility.

It is powerful but should be controlled.

## 16.3 Tomcat Migration Tool for Jakarta EE

Apache Tomcat provides a migration tool that converts Java EE 8-style web applications to Jakarta EE 9-style packages for Tomcat 10+.

It is useful for Servlet/JSP-based WAR migration.

## 16.4 Tool choice matrix

| Need | Tool |
|---|---|
| Source code migration | OpenRewrite / IDE refactor |
| Maven/Gradle dependency rewrite | OpenRewrite |
| Binary JAR/WAR transformation | Eclipse Transformer |
| Tomcat webapp migration | Tomcat Migration Tool |
| Manual precise cleanup | IDE + tests |
| Large repo fleet automation | OpenRewrite + CI report |

## 16.5 Tools are accelerators, not substitutes for understanding

Automated tools cannot fully decide:

- whether dependency version is correct;
- whether runtime supports target spec;
- whether behavior changed;
- whether business contract remains compatible;
- whether rollback is safe.

Use tools to reduce mechanical work, then review semantically.

---

# 17. Spring Boot 2 ke Spring Boot 3 sebagai Studi Kasus

## 17.1 Why Spring Boot 3 matters

Spring Boot 3 and Spring Framework 6 are Jakarta-era.

Common changes:

```text
Java baseline 17+
Spring Framework 6
Jakarta EE APIs
Hibernate 6+
Servlet 6 / Tomcat 10+
Bean Validation jakarta
JPA jakarta
```

## 17.2 Recommended path

For large apps:

```text
1. Upgrade to latest Spring Boot 2.7.x
2. Ensure Java 17 compatibility
3. Resolve deprecations
4. Upgrade dependencies to Boot 3-compatible versions
5. Apply javax → jakarta migration
6. Upgrade to Spring Boot 3.x
7. Run full integration/performance tests
```

Do not jump from Boot 2.1 on Java 8 directly to Boot 3.x unless app is tiny and tests are strong.

## 17.3 Common imports

Old:

```java
import javax.persistence.Entity;
import javax.validation.Valid;
import javax.servlet.http.HttpServletRequest;
```

New:

```java
import jakarta.persistence.Entity;
import jakarta.validation.Valid;
import jakarta.servlet.http.HttpServletRequest;
```

## 17.4 Hibernate 6 impact

Spring Boot 3 upgrades Hibernate major version.

Expect possible changes in:

- query parsing;
- dialect;
- type mapping;
- ID generation;
- criteria API behavior;
- sequence naming;
- pagination SQL;
- lazy loading;
- native query result mapping.

Integration tests with real database are mandatory.

## 17.5 Validation impact

Old:

```java
javax.validation.Valid
javax.validation.constraints.NotNull
```

New:

```java
jakarta.validation.Valid
jakarta.validation.constraints.NotNull
```

Make sure provider is Jakarta-compatible, e.g. Hibernate Validator Jakarta versions.

## 17.6 Servlet impact

Tomcat 9 vs 10 boundary:

```text
Tomcat 9 = javax.servlet
Tomcat 10+ = jakarta.servlet
```

Spring Boot 3 embedded Tomcat is Jakarta-era.

Custom filters/listeners must migrate.

## 17.7 Test impact

Update:

- Spring Test;
- MockMvc assumptions;
- Testcontainers;
- Mockito/Byte Buddy;
- REST-assured;
- WireMock;
- old servlet mocks.

## 17.8 Production impact

Update:

- Docker base image;
- Java runtime;
- APM agent;
- Kubernetes probes if startup changes;
- memory/GC baseline;
- dashboards if metrics names changed.

---

# 18. Jakarta EE Runtime sebagai Studi Kasus

## 18.1 Runtime must match app namespace

If app uses:

```java
jakarta.ws.rs.Path
```

runtime must provide Jakarta RESTful Web Services namespace.

If app uses:

```java
javax.ws.rs.Path
```

runtime must be Java EE 8/Jakarta EE 8 era.

## 18.2 WAR deployment

For WAR to Jakarta EE 10/11 runtime:

- source imports must be `jakarta.*`;
- API dependency should be `provided`;
- no bundled old `javax.*` APIs;
- deployment descriptors updated;
- libraries Jakarta-compatible.

## 18.3 EAR deployment

EAR migration is more complex:

- multiple modules;
- shared libs;
- EJB modules;
- WAR modules;
- classloader isolation;
- deployment descriptors;
- vendor-specific descriptors;
- resource adapters;
- JMS/JTA resources.

Migrate module by module but deploy compatibility must be tested as a whole.

## 18.4 Vendor extensions

Application may use vendor-specific classes/config.

Example:

```text
jboss-*.xml
weblogic-*.xml
glassfish-*.xml
openliberty config
payara descriptors
```

Namespace migration may not cover vendor extension changes.

## 18.5 TCK compatibility does not guarantee your app behavior

A compatible runtime passes Jakarta TCK for specs, but your app may rely on:

- vendor behavior;
- undocumented defaults;
- timing;
- classloader quirks;
- old deployment descriptors;
- non-portable extension.

So integration tests on target runtime remain required.

---

# 19. JPA/Hibernate Migration Notes

## 19.1 Annotation migration

Old:

```java
import javax.persistence.Entity;
import javax.persistence.Id;
import javax.persistence.OneToMany;
```

New:

```java
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
```

## 19.2 Provider alignment

Do not mix:

```text
jakarta.persistence-api 3.x
with old Hibernate 5.x javax provider
```

Use provider version that supports Jakarta Persistence target.

## 19.3 `persistence.xml`

Update schema namespace/version and provider if needed.

## 19.4 Entity scanning issue

If entity still annotated with `javax.persistence.Entity`, Jakarta provider may not detect it.

Symptom:

```text
Not a managed type
Unknown entity
```

## 19.5 Attribute converters

Old:

```java
javax.persistence.AttributeConverter
```

New:

```java
jakarta.persistence.AttributeConverter
```

## 19.6 Criteria API

Old:

```java
javax.persistence.criteria.CriteriaBuilder
```

New:

```java
jakarta.persistence.criteria.CriteriaBuilder
```

## 19.7 Test real queries

Major provider upgrade can affect query behavior even after namespace migration.

Test:

- JPQL;
- Criteria;
- native queries;
- projections;
- pagination;
- locking;
- lazy loading;
- batch fetching;
- transaction boundaries.

---

# 20. Servlet/JAX-RS/Validation/JAXB/JMS Migration Notes

## 20.1 Servlet

Old:

```java
javax.servlet.Filter
javax.servlet.http.HttpServletRequest
javax.servlet.annotation.WebFilter
```

New:

```java
jakarta.servlet.Filter
jakarta.servlet.http.HttpServletRequest
jakarta.servlet.annotation.WebFilter
```

Watch:

- filters;
- listeners;
- servlet annotations;
- `web.xml`;
- container version;
- embedded server;
- custom auth filter.

## 20.2 JAX-RS / Jakarta REST

Old:

```java
javax.ws.rs.GET
javax.ws.rs.Path
javax.ws.rs.core.Response
javax.ws.rs.ext.ExceptionMapper
```

New:

```java
jakarta.ws.rs.GET
jakarta.ws.rs.Path
jakarta.ws.rs.core.Response
jakarta.ws.rs.ext.ExceptionMapper
```

Watch:

- providers;
- filters;
- exception mappers;
- client API;
- media type config;
- runtime implementation.

## 20.3 Bean Validation

Old:

```java
javax.validation.Valid
javax.validation.constraints.NotBlank
```

New:

```java
jakarta.validation.Valid
jakarta.validation.constraints.NotBlank
```

Watch:

- validation provider;
- custom constraints;
- `ConstraintValidator`;
- validation XML;
- method validation;
- error response mapping.

## 20.4 JAXB

Old:

```java
javax.xml.bind.JAXBContext
```

New:

```java
jakarta.xml.bind.JAXBContext
```

Watch:

- generated classes;
- binding files;
- Maven JAXB plugins;
- XML schema;
- adapter classes;
- runtime implementation.

## 20.5 JMS

Old:

```java
javax.jms.Message
javax.jms.Queue
javax.jms.ConnectionFactory
```

New:

```java
jakarta.jms.Message
jakarta.jms.Queue
jakarta.jms.ConnectionFactory
```

Watch:

- broker client library;
- resource adapter;
- app server integration;
- message-driven beans;
- transaction.

## 20.6 Mail

Old:

```java
javax.mail.Message
```

New:

```java
jakarta.mail.Message
```

Watch:

- dependencies;
- activation API;
- provider implementation;
- TLS/auth config.

---

# 21. Testing Strategy

## 21.1 Unit tests

Unit tests catch source-level migration issues.

But they may not catch:

- runtime container mismatch;
- JPA provider mismatch;
- servlet filter wiring;
- validation provider behavior;
- XML descriptor issue;
- classloader conflict.

## 21.2 Integration tests

Use real runtime where possible:

- Testcontainers with target database;
- embedded Tomcat/Jetty if Spring Boot;
- target Jakarta EE runtime container;
- real JPA provider;
- real validation provider;
- real REST stack.

## 21.3 Contract tests

Migration can change output shape.

Test:

- JSON response;
- XML payload;
- error response;
- validation message structure;
- headers;
- status codes;
- event payload.

## 21.4 Dependency tree test

Add CI check to fail if old namespace appears where not allowed.

Example script:

```bash
mvn dependency:tree | grep "javax.servlet" && exit 1
```

But be careful not to ban valid Java SE `javax.*` packages.

Better: ban specific Jakarta EE old artifacts.

## 21.5 Bytecode scan

Use `jdeps`, `grep` on class files, or specialized tools to detect `javax/servlet`, `javax/persistence`, etc.

```bash
jar tf target/app.jar | grep javax
```

For bytecode constant pool:

```bash
javap -classpath target/classes -v com.example.SomeClass | grep javax
```

## 21.6 Runtime smoke tests

Smoke test on target runtime:

- start app;
- health endpoint;
- one REST endpoint;
- one DB operation;
- one validation failure;
- one transaction rollback;
- one JSON/XML serialization;
- one security check;
- one graceful shutdown.

---

# 22. Production Rollout Strategy

## 22.1 Do not combine migration with feature release

Namespace migration should be behavior-preserving.

Avoid mixing:

- new feature;
- database redesign;
- API breaking change;
- performance rewrite;
- business rule change.

## 22.2 Compatibility with rollback

Rollback issue:

```text
New app writes data/event old app cannot read.
```

If migration only changes namespace and runtime, data contract should remain same. Ensure no accidental JSON/XML/event schema change.

## 22.3 Canary

Roll out to small percentage:

- compare error rate;
- compare latency;
- compare memory;
- compare logs;
- compare DB queries;
- compare event payload;
- compare validation errors.

## 22.4 Observability during rollout

Monitor:

- startup failures;
- class loading errors;
- `NoClassDefFoundError`;
- `ClassNotFoundException`;
- validation failures;
- JPA entity scanning;
- transaction rollback;
- HTTP 5xx;
- p95/p99;
- GC;
- memory;
- thread count;
- DB pool;
- APM traces.

## 22.5 Rollback condition

Define before deploy:

```text
rollback if:
- error rate > 1% for 5 minutes
- startup failure in > 1 pod
- critical endpoint p99 > 2x baseline
- data contract mismatch detected
- event consumer failure detected
```

---

# 23. Common Failure Modes dan Diagnosis

## 23.1 `ClassNotFoundException: javax.servlet.Filter`

Cause:

- old library expecting `javax.servlet`;
- running on Jakarta runtime.

Fix:

- upgrade library;
- use Jakarta variant;
- transform artifact as temporary bridge.

## 23.2 `ClassNotFoundException: jakarta.servlet.Filter`

Cause:

- app/library expects Jakarta servlet;
- runtime is old Java EE/Tomcat 9.

Fix:

- upgrade runtime to Tomcat 10+/Jakarta EE 9+;
- or keep app on `javax` stack.

## 23.3 `Not a managed type`

Cause:

- entity annotation namespace mismatch;
- scanning config wrong;
- JPA provider mismatch.

Check:

```java
import jakarta.persistence.Entity;
```

not old `javax`.

## 23.4 Validation not triggered

Cause:

- old `javax.validation.Valid` annotation with Jakarta validator;
- method validation config mismatch;
- provider missing.

Fix imports/provider.

## 23.5 Servlet filter not invoked

Cause:

- old `javax.servlet.Filter` implementation in Jakarta runtime;
- wrong registration descriptor;
- `web.xml` namespace mismatch.

## 23.6 LinkageError / NoSuchMethodError

Cause:

- mixed versions;
- library compiled against different API version;
- transitive dependency conflict.

Use dependency tree and classpath inspection.

## 23.7 Tests pass but production fails

Cause:

- tests run with embedded runtime but production external container differs;
- API jar bundled differently;
- classloader behavior different;
- deployment descriptor not tested.

Run tests on production-like runtime.

## 23.8 APM traces disappear

Cause:

- agent instruments `javax` classes but app uses `jakarta`;
- old agent version.

Fix:

- upgrade agent;
- verify Jakarta instrumentation support.

---

# 24. Migration Checklist

## 24.1 Inventory

- [ ] List all `javax.*` imports.
- [ ] Separate Jakarta EE `javax.*` from Java SE `javax.*`.
- [ ] List dependencies using Java EE APIs.
- [ ] Identify runtime/container version.
- [ ] Identify framework version.
- [ ] Identify generated code.
- [ ] Identify XML/config descriptors.
- [ ] Identify APM/agent.
- [ ] Identify tests using old APIs.

## 24.2 Dependency alignment

- [ ] Use Jakarta-compatible framework versions.
- [ ] Use Jakarta-compatible runtime.
- [ ] Use Jakarta-compatible JPA provider.
- [ ] Use Jakarta-compatible validation provider.
- [ ] Use Jakarta-compatible REST/Servlet runtime.
- [ ] Remove old Java EE API dependencies.
- [ ] Check transitive dependencies.
- [ ] Use BOM/platform where possible.

## 24.3 Source migration

- [ ] Update Jakarta EE imports.
- [ ] Do not change Java SE `javax.*` imports.
- [ ] Update string-based class references.
- [ ] Update generated source or generator.
- [ ] Update custom annotations/interfaces.
- [ ] Update public API signatures if necessary.

## 24.4 Config migration

- [ ] Update `web.xml`.
- [ ] Update `persistence.xml`.
- [ ] Update `beans.xml`.
- [ ] Update `validation.xml`.
- [ ] Update JSP/TLD.
- [ ] Update service loader metadata.
- [ ] Update properties/YAML strings.

## 24.5 Testing

- [ ] Compile.
- [ ] Unit tests.
- [ ] Integration tests with real runtime.
- [ ] JPA tests.
- [ ] REST tests.
- [ ] Validation tests.
- [ ] Security tests.
- [ ] Serialization contract tests.
- [ ] Runtime smoke tests.
- [ ] Performance baseline.

## 24.6 Rollout

- [ ] Canary plan.
- [ ] Dashboard ready.
- [ ] Rollback plan.
- [ ] Error budget threshold.
- [ ] Runtime image updated.
- [ ] APM agent updated.
- [ ] Runbook updated.

---

# 25. Latihan Bertahap

## Latihan 1 — Klasifikasi `javax.*`

Ambil codebase dan buat daftar semua `javax.*` import.

Klasifikasikan:

```text
A. Must migrate to jakarta
B. Must stay javax because Java SE
C. Need library-specific decision
```

Contoh:

```java
javax.persistence.Entity        → migrate
javax.validation.Valid          → migrate
javax.crypto.Cipher             → stay
javax.sql.DataSource            → stay
javax.xml.parsers.DocumentBuilderFactory → stay
javax.xml.bind.JAXBContext      → migrate
```

## Latihan 2 — Dependency tree audit

Jalankan:

```bash
mvn dependency:tree > dependency-tree.txt
```

Cari:

```text
javax.servlet
javax.persistence
javax.validation
javax.ws.rs
javax.xml.bind
```

Buat report:

```text
which dependency brings old API?
is it direct or transitive?
is Jakarta-compatible version available?
```

## Latihan 3 — Runtime mismatch

Buat servlet sederhana `javax.servlet.Filter`, deploy ke Tomcat 10.

Amati failure.

Migrasikan ke `jakarta.servlet.Filter`.

Deploy ulang.

## Latihan 4 — JPA annotation mismatch

Buat entity dengan `javax.persistence.Entity`, jalankan dengan Jakarta Hibernate provider.

Amati entity not detected.

Migrasikan ke `jakarta.persistence.Entity`.

## Latihan 5 — Validation mismatch

Gunakan `javax.validation.Valid` di Spring Boot 3/Jakarta stack.

Amati validation behavior.

Migrasikan ke `jakarta.validation.Valid`.

## Latihan 6 — OpenRewrite migration

Jalankan recipe `JavaxMigrationToJakarta` di project kecil.

Review diff:

- imports;
- pom;
- config;
- tests.

Catat apa yang tidak otomatis selesai.

## Latihan 7 — Binary transformation

Ambil WAR Java EE 8 kecil.

Transform dengan Tomcat Migration Tool atau Eclipse Transformer.

Deploy ke Tomcat 10.

Catat:

- what works;
- what breaks;
- what still needs source migration.

## Latihan 8 — Contract regression

Sebelum dan sesudah migration, bandingkan:

- JSON response;
- XML response;
- validation error;
- status code;
- headers.

Pastikan tidak berubah tanpa sengaja.

---

# 26. Mini Project: Migrasi Legacy `javax` Service ke `jakarta`

## 26.1 Goal

Migrasikan service kecil dari `javax.*` era ke `jakarta.*` era.

## 26.2 Initial stack

```text
Java 11 or 17
Spring Boot 2.7 or Jakarta EE 8-style app
javax.servlet
javax.persistence
javax.validation
JPA/Hibernate
REST endpoint
PostgreSQL via Testcontainers
```

## 26.3 Target stack

```text
Java 17/21/25
Spring Boot 3.x or Jakarta EE 10/11 runtime
jakarta.servlet
jakarta.persistence
jakarta.validation
Jakarta-compatible provider/runtime
```

## 26.4 Features

Endpoints:

```text
POST /cases
GET /cases/{id}
POST /cases/{id}/close
```

Domain:

```text
Case
  id
  title
  status
  createdAt
  closedAt
```

Validation:

- title required;
- close reason required.

Persistence:

- JPA entity;
- repository;
- transaction.

## 26.5 Migration steps

1. Capture baseline tests.
2. Capture dependency tree.
3. Classify `javax.*` imports.
4. Upgrade framework/runtime.
5. Apply automated migration.
6. Manually fix Java SE `javax.*` mistakes if any.
7. Update dependencies.
8. Update config descriptors.
9. Run compile.
10. Run unit tests.
11. Run integration tests.
12. Run contract tests.
13. Run production-like smoke test.
14. Document failure modes.

## 26.6 Required deliverables

```text
MIGRATION_PLAN.md
DEPENDENCY_TREE_BEFORE.txt
DEPENDENCY_TREE_AFTER.txt
JAVAX_IMPORT_AUDIT.md
MIGRATION_DIFF_SUMMARY.md
CONTRACT_TEST_REPORT.md
RUNTIME_SMOKE_TEST_REPORT.md
ROLLBACK_PLAN.md
```

## 26.7 Acceptance criteria

- no old Jakarta EE `javax.*` imports remain;
- Java SE `javax.*` imports remain correct;
- dependency tree has no old Java EE API artifacts;
- runtime/container is Jakarta-compatible;
- tests pass;
- JSON/error contract unchanged unless documented;
- application starts in target runtime;
- rollback plan documented.

---

# 27. Referensi Resmi

Referensi utama:

1. Jakarta EE Blog — Javax to Jakarta Namespace Ecosystem Progress  
   https://jakarta.ee/blogs/javax-jakartaee-namespace-ecosystem-progress/

2. Jakarta EE 9 Release Page  
   https://jakarta.ee/release/9/

3. Jakarta EE 9 Platform Specification — Changes in Jakarta EE 9 and namespace section  
   https://jakarta.ee/specifications/platform/9/jakarta-platform-spec-9.html

4. Jakarta EE 11 Platform Specification  
   https://jakarta.ee/specifications/platform/11/

5. Jakarta EE 11 Web Profile Specification  
   https://jakarta.ee/specifications/webprofile/11/

6. Jakarta EE 11 Core Profile Specification  
   https://jakarta.ee/specifications/coreprofile/11/

7. OpenRewrite Recipe — Migrate to Jakarta EE 9  
   https://docs.openrewrite.org/recipes/java/migrate/jakarta/javaxmigrationtojakarta

8. Eclipse Transformer Project  
   https://projects.eclipse.org/projects/technology.transformer

9. Eclipse Transformer GitHub  
   https://github.com/eclipse-transformer/transformer

10. Apache Tomcat Migration Tool for Jakarta EE  
    https://tomcat.apache.org/download-migration.cgi

11. Apache Tomcat Jakarta EE Migration Tool GitHub  
    https://github.com/apache/tomcat-jakartaee-migration

12. Spring Boot 3 Migration Guide  
    https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide

13. Spring Framework 6 Documentation  
    https://docs.spring.io/spring-framework/reference/

14. Hibernate ORM Documentation  
    https://hibernate.org/orm/documentation/

---

# Penutup

Migrasi `javax.*` ke `jakarta.*` adalah latihan disiplin alignment.

Kalau diringkas:

```text
Jangan berpikir:
  replace javax with jakarta

Berpikirlah:
  align source + dependencies + runtime + config + generated code + tests + tools + production deployment
```

Kesalahan terbesar adalah menganggap namespace hanya masalah syntax. Dalam JVM, namespace adalah bagian dari type identity dan binary contract. Dalam ecosystem enterprise, namespace adalah bagian dari framework/runtime compatibility.

Engineer yang kuat tidak hanya bisa membuat compiler hijau. Ia bisa memastikan:

- dependency graph bersih;
- runtime cocok;
- annotation terbaca;
- JPA entity terdeteksi;
- validation bekerja;
- servlet/JAX-RS pipeline berjalan;
- JSON/XML contract tidak berubah;
- APM tetap menginstrumentasi;
- rollout aman;
- rollback mungkin;
- dan tidak ada `javax` lama yang tersembunyi sebagai bom waktu.

Itulah mental model yang akan kita pakai untuk seluruh materi Jakarta berikutnya.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 0 — Jakarta Package: Big Picture, Sejarah, dan Mental Model](./learn-java-jakarta-part-000.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 2 — Jakarta EE Platform, Web Profile, dan Core Profile](./learn-java-jakarta-part-002.md)
