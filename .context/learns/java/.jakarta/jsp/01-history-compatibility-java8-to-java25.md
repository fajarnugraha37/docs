# Part 1 — Historical Evolution dan Compatibility Matrix: JSP, JSTL, EL, JSF, Jakarta Faces

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `01-history-compatibility-java8-to-java25.md`  
> Fokus: memahami evolusi, garis kompatibilitas, namespace break, dan strategi membaca stack UI server-side Java dari Java 8 sampai Java 25.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan evolusi **JSP / Jakarta Pages**, **Expression Language**, **JSTL / Jakarta Tags**, dan **JSF / Jakarta Faces** dari era Java EE sampai Jakarta EE modern.
2. Membedakan masalah **bahasa Java**, **spesifikasi Jakarta EE**, **container runtime**, dan **library implementation**.
3. Membaca stack legacy `javax.*` dan stack modern `jakarta.*` tanpa mencampur dependency yang tidak kompatibel.
4. Menentukan baseline versi yang masuk akal untuk aplikasi Java 8, 11, 17, 21, dan 25.
5. Mengidentifikasi risiko migrasi utama: namespace, taglib URI, CDI integration, Faces lifecycle, TLD, container, dan third-party component library.
6. Membuat keputusan arsitektural: tetap maintain JSP/JSF legacy, migrasi ke Jakarta, refactor ke Facelets, atau strangler ke UI modern.

---

## 1. Core Mental Model: Ini Bukan Satu Teknologi, Ini Empat Layer yang Berevolusi Bersama

Ketika orang berkata “aplikasi JSP/JSF”, biasanya ada beberapa layer yang bercampur:

```text
Browser
  |
  | HTTP request / response
  v
Servlet Container
  |
  +-- Servlet API
  |
  +-- Pages/JSP engine
  |     - translate .jsp menjadi servlet
  |     - compile servlet
  |     - execute generated servlet
  |
  +-- EL engine
  |     - evaluate ${...} / #{...}
  |     - resolve object, property, method, function
  |
  +-- Tags/JSTL/custom tags
  |     - execute reusable view logic
  |     - loops, conditionals, formatting, URL, i18n
  |
  +-- Faces runtime
        - build component tree
        - restore/apply/validate/update/invoke/render
        - manage state and navigation
```

Hal penting: **Java version bukan sama dengan Jakarta EE version**.

Contoh:

- Java 8 adalah versi bahasa/runtime Java.
- Java EE 8 adalah platform enterprise API berbasis `javax.*`.
- Jakarta EE 8 masih memakai `javax.*`, tetapi sudah di bawah Eclipse Foundation.
- Jakarta EE 9 adalah titik perubahan namespace ke `jakarta.*`.
- Jakarta EE 10/11 membawa baseline modern dan cleanup lebih jauh.

Jadi saat menganalisis aplikasi lama, pertanyaan yang benar bukan hanya:

> “Ini pakai Java berapa?”

Tetapi:

1. JDK runtime-nya versi berapa?
2. Container-nya apa dan versi berapa?
3. API spec-nya Java EE atau Jakarta EE?
4. Namespace kode-nya `javax.*` atau `jakarta.*`?
5. JSP taglib URI-nya legacy atau Jakarta?
6. Faces implementation-nya Mojarra/MyFaces versi apa?
7. Component library-nya mendukung namespace yang sama atau tidak?

---

## 2. Timeline Besar: Dari Java EE ke Jakarta EE

### 2.1 Era Java EE: `javax.*` sebagai dunia utama

Pada era Java EE, teknologi web server-side Java memakai nama-nama seperti:

- JavaServer Pages / JSP
- JavaServer Faces / JSF
- JavaServer Pages Standard Tag Library / JSTL
- Unified Expression Language / EL
- Servlet API
- CDI
- Bean Validation

Namespace API umumnya memakai:

```java
javax.servlet.*
javax.servlet.jsp.*
javax.el.*
javax.faces.*
javax.enterprise.*
javax.validation.*
```

Untuk aplikasi yang lahir di Java 6/7/8 era, ini normal.

Contoh JSP lama:

```jsp
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>

<c:forEach var="item" items="${items}">
    ${item.name}
</c:forEach>
```

Contoh JSF lama:

```java
import javax.faces.view.ViewScoped;
import javax.inject.Named;

@Named
@ViewScoped
public class CaseBean implements Serializable {
}
```

Ini bukan “salah”. Ini hanya berada pada generasi API yang berbeda.

---

### 2.2 Jakarta EE 8: Bridge Release

Jakarta EE 8 adalah transisi kelembagaan dari Java EE ke Jakarta EE, tetapi API package masih tetap `javax.*`.

Mental model:

```text
Java EE 8      : javax.*
Jakarta EE 8   : javax.*  (bridge)
Jakarta EE 9+  : jakarta.*
```

Jakarta EE 8 penting untuk migration planning karena banyak organisasi enterprise tidak langsung lompat dari Java EE 8 ke Jakarta EE 10/11. Mereka sering melewati tahap:

```text
Legacy app on Java EE 7/8
  -> upgrade container to Jakarta EE 8 compatible runtime
  -> clean dependencies
  -> improve tests
  -> namespace migration to Jakarta EE 9+
  -> upgrade to Jakarta EE 10/11
```

Kenapa bridge ini penting?

Karena migration risk terbesar bukan hanya import rename, tetapi:

- third-party library belum kompatibel,
- container behavior berubah,
- taglib URI berubah,
- Faces component library belum siap,
- custom filters/listeners/tags masih memakai API lama,
- deployment descriptor masih memakai schema lama,
- test coverage legacy sering rendah.

---

### 2.3 Jakarta EE 9: Namespace Break

Jakarta EE 9 adalah garis patah utama:

```text
javax.*  ->  jakarta.*
```

Contoh:

```java
// sebelum
import javax.servlet.http.HttpServletRequest;
import javax.faces.context.FacesContext;
import javax.el.ELContext;

// sesudah
import jakarta.servlet.http.HttpServletRequest;
import jakarta.faces.context.FacesContext;
import jakarta.el.ELContext;
```

Ini terlihat sederhana, tetapi secara binary compatibility sangat besar.

Library yang dikompilasi terhadap `javax.servlet.*` tidak otomatis kompatibel dengan runtime yang mengharapkan `jakarta.servlet.*`. Nama class di bytecode berbeda.

Artinya:

```text
javax.servlet.http.HttpServletRequest
```

dan

```text
jakarta.servlet.http.HttpServletRequest
```

adalah dua tipe berbeda.

Mereka punya nama mirip dan konsep sama, tetapi bagi JVM mereka berbeda.

---

## 3. Evolusi JSP / Jakarta Pages

### 3.1 Apa itu JSP/Jakarta Pages?

JSP/Jakarta Pages adalah template engine server-side untuk web Java.

Sebuah file `.jsp` tidak dieksekusi sebagai file teks biasa. Container melakukan:

```text
.jsp file
  -> translation
  -> generated servlet source
  -> compilation
  -> servlet class
  -> request handling
  -> HTML response
```

Jadi JSP adalah cara menulis servlet yang berorientasi template.

---

### 3.2 Nama dan posisi spesifikasi

Secara historis:

```text
JavaServer Pages (JSP)
  -> Jakarta Server Pages
  -> Jakarta Pages
```

Dalam praktik, banyak dokumentasi, container, dan developer masih memakai istilah “JSP”. Untuk komunikasi teknis, sebutan berikut sering interchangeable secara informal:

- JSP
- Server Pages
- Jakarta Pages

Tetapi untuk dependency modern, namespace-nya mengikuti Jakarta.

---

### 3.3 JSP di era Java EE 8 / Jakarta EE 8

Ciri umum:

- API masih `javax.servlet.jsp.*`.
- Taglib lama sering memakai URI `http://java.sun.com/jsp/jstl/...` atau `http://xmlns.jcp.org/jsp/jstl/...`.
- Banyak aplikasi masih memakai scriptlet lama.
- EL sudah menjadi default view expression mechanism.
- JSP sering dipakai bersama Spring MVC, Struts, atau servlet controller custom.

Contoh dependency era lama:

```xml
<dependency>
    <groupId>javax.servlet</groupId>
    <artifactId>javax.servlet-api</artifactId>
    <version>4.0.1</version>
    <scope>provided</scope>
</dependency>
```

---

### 3.4 Jakarta Pages 3.x/4.x

Pada Jakarta EE 9+, API bergeser ke `jakarta.*`.

Contoh package:

```java
jakarta.servlet.jsp.*
jakarta.servlet.jsp.tagext.*
```

Jakarta Pages 4.0 adalah release untuk Jakarta EE 11. Secara konseptual, Pages tetap template engine untuk web app, tetapi ekosistemnya sekarang berada di dunia `jakarta.*`.

Implikasi praktis:

- Container harus mendukung Jakarta Servlet/Jakarta Pages versi yang sesuai.
- Tag library harus cocok dengan Jakarta namespace.
- Custom tag handler harus di-recompile terhadap API Jakarta.
- Deployment descriptor dan taglib URI perlu dicek.

---

## 4. Evolusi EL / Jakarta Expression Language

### 4.1 EL sebagai bahasa binding lintas teknologi

Expression Language bukan hanya milik JSP. EL dipakai oleh beberapa teknologi Jakarta EE, terutama:

- Pages/JSP,
- Faces,
- Bean Validation message interpolation dalam konteks tertentu,
- CDI integration pada view binding.

EL memberi kemampuan:

```jsp
${user.name}
${empty items}
${order.total > 1000000}
```

Dan pada Faces:

```xhtml
<h:inputText value="#{caseBean.caseTitle}" />
<h:commandButton action="#{caseBean.submit}" />
```

Perbedaan penting:

```text
${...} = immediate/value expression, umum di JSP/JSTL
#{...} = deferred expression, penting di Faces karena lifecycle butuh evaluate pada fase berbeda
```

---

### 4.2 Evolusi kemampuan EL

EL berkembang dari expression sederhana menjadi language yang lebih kaya:

- property resolution,
- method expression,
- lambda-like features pada versi tertentu,
- collection access,
- custom function,
- custom resolver,
- integration dengan CDI,
- type coercion,
- null handling.

Namun untuk engineer senior, hal yang paling penting bukan fitur sintaks, melainkan **resolver chain**.

Saat EL mengevaluasi:

```jsp
${case.owner.name}
```

EL tidak “langsung tahu” object mana yang dimaksud. Ia berjalan melalui resolver chain:

```text
Expression: case.owner.name

1. Cari variable "case"
   - page scope?
   - request scope?
   - session scope?
   - application scope?
   - CDI bean?
   - implicit object?

2. Setelah case ditemukan, resolve property "owner"
   - Map key?
   - List index?
   - Array index?
   - JavaBean getter?

3. Setelah owner ditemukan, resolve property "name"
   - getName()?
   - isName()?
   - record accessor?
   - custom resolver?
```

Inilah akar banyak bug:

- object tidak ada di scope yang diharapkan,
- getter salah nama,
- null property chain,
- Map key menutupi bean property,
- method overloaded ambigu,
- type coercion tidak sesuai ekspektasi.

---

### 4.3 EL 6.0 di Jakarta EE 11

Jakarta Expression Language 6.0 adalah bagian dari Jakarta EE 11 family. Secara strategis, EE 11 melakukan cleanup seperti penghapusan referensi lama yang tidak lagi sesuai dengan Java modern, termasuk arah platform yang tidak lagi bergantung pada SecurityManager lama.

Untuk aplikasi server-side UI, dampaknya:

- expression evaluation makin selaras dengan platform Jakarta modern,
- custom EL extension harus dicek compatibility-nya,
- library lama berbasis `javax.el.*` tidak cocok langsung dengan `jakarta.el.*`,
- container harus menyediakan implementation yang sesuai.

---

## 5. Evolusi JSTL / Jakarta Standard Tag Library / Jakarta Tags

### 5.1 JSTL sebagai view logic abstraction

JSTL muncul untuk mengurangi scriptlet di JSP.

Daripada:

```jsp
<% for (Item item : items) { %>
    <%= item.getName() %>
<% } %>
```

Gunakan:

```jsp
<c:forEach var="item" items="${items}">
    <c:out value="${item.name}" />
</c:forEach>
```

JSTL menyediakan tag untuk:

- conditional rendering,
- iteration,
- output,
- URL building,
- formatting,
- i18n,
- XML processing,
- SQL tags legacy.

---

### 5.2 URI taglib legacy vs Jakarta

Ini salah satu titik migrasi paling sering rusak.

Legacy Java EE/Jakarta EE 8:

```jsp
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="fmt" uri="http://java.sun.com/jsp/jstl/fmt" %>
```

Atau variasi lebih baru sebelum Jakarta namespace penuh:

```jsp
<%@ taglib prefix="c" uri="http://xmlns.jcp.org/jsp/jstl/core" %>
```

Jakarta Tags 3.x memakai URI baru seperti:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
<%@ taglib prefix="fn" uri="jakarta.tags.functions" %>
<%@ taglib prefix="x" uri="jakarta.tags.xml" %>
<%@ taglib prefix="sql" uri="jakarta.tags.sql" %>
```

Jika URI JSP sudah diganti tetapi dependency implementation belum cocok, error yang muncul biasanya seperti:

```text
The absolute uri: [jakarta.tags.core] cannot be resolved
Unable to find taglib [c] for URI [jakarta.tags.core]
```

Masalah ini bukan error “EL” atau error “JSP syntax”. Biasanya akar masalahnya salah satu:

1. JSTL API ada tetapi implementation tidak ada.
2. Implementation ada tetapi versi tidak cocok dengan container.
3. Container tidak mendukung versi Jakarta Pages yang digunakan.
4. JAR taglib tidak ada di `WEB-INF/lib` atau dependency packaging salah.
5. Masih mencampur artifact `javax` dan `jakarta`.

---

### 5.3 SQL tags: pahami, tapi jangan jadikan pattern modern

JSTL punya SQL tags karena sejarah JSP pernah dipakai untuk aplikasi kecil atau demo langsung ke database.

Namun untuk enterprise modern, SQL tags hampir selalu smell karena:

- view layer tahu query database,
- transaction boundary kabur,
- security dan authorization sulit dikontrol,
- testability buruk,
- connection management bocor ke UI,
- mengacaukan separation of concerns.

Engineer senior tidak perlu fanatik melarang tanpa konteks, tetapi default decision untuk sistem enterprise adalah:

```text
JSP/Faces view
  -> receives prepared view model
  -> does not query database directly
```

---

## 6. Evolusi JSF / Jakarta Faces

### 6.1 JSF bukan JSP

Kesalahan umum:

> “JSF itu JSP yang lebih advanced.”

Lebih tepat:

```text
JSP/Jakarta Pages = template-to-servlet view technology
JSF/Jakarta Faces = component-based MVC web UI framework
```

Faces punya:

- component tree,
- lifecycle phases,
- converters,
- validators,
- navigation,
- events,
- state saving,
- Ajax partial rendering,
- reusable components,
- integration dengan CDI dan Bean Validation.

---

### 6.2 JSF lama pernah bisa memakai JSP, tetapi modern Faces memakai Facelets

Pada era lama, JSF bisa dipakai dengan JSP sebagai view declaration language. Namun praktik modern JSF/Faces menggunakan **Facelets** (`.xhtml`).

Alasannya:

- Facelets lebih cocok untuk component tree.
- Template composition lebih baik.
- Lifecycle Faces lebih alami dibanding JSP rendering model.
- JSP dan JSF punya timing execution berbeda yang bisa membingungkan.

Mental model:

```text
JSP:
  request masuk
  -> template dieksekusi
  -> response HTML keluar

Faces + Facelets:
  request/postback masuk
  -> restore/build component tree
  -> apply request values
  -> validate
  -> update model
  -> invoke action
  -> render component tree
  -> response HTML keluar
```

---

### 6.3 Namespace JSF/Faces

Legacy:

```java
javax.faces.*
```

Modern Jakarta:

```java
jakarta.faces.*
```

Legacy Facelets namespace sering seperti:

```xhtml
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="http://xmlns.jcp.org/jsf/html"
      xmlns:f="http://xmlns.jcp.org/jsf/core"
      xmlns:ui="http://xmlns.jcp.org/jsf/facelets">
```

Modern Jakarta Faces dapat memakai URN-style namespace seperti:

```xhtml
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html"
      xmlns:f="jakarta.faces.core"
      xmlns:ui="jakarta.faces.facelets">
```

Dalam migrasi, namespace XML/Facelets harus dicek bersama versi Faces runtime dan component library.

---

## 7. Compatibility Matrix Besar: Java Version vs Enterprise Web UI Stack

Matrix ini bukan hukum mutlak. Container vendor bisa memberi support berbeda. Tetapi sebagai mental model engineering, ini berguna.

### 7.1 Java 8 baseline

| Area | Umum di Java 8 era |
|---|---|
| Platform | Java EE 7/8, Jakarta EE 8 |
| Namespace | `javax.*` |
| Servlet | 3.1 / 4.0 era |
| JSP/Pages | JSP 2.x era |
| EL | EL 3.x era |
| JSTL/Tags | JSTL 1.2 |
| JSF/Faces | JSF 2.2 / 2.3 |
| Runtime umum | Tomcat 8.5/9, WildFly lama, Payara/GlassFish lama, WebLogic lama |
| Risiko | legacy scriptlet, old taglib URI, old JSF managed bean, weak CDI integration |

Java 8 adalah baseline legacy paling umum untuk aplikasi enterprise lama. Jika aplikasi masih Java 8, biasanya tidak bijak langsung “copy import ke jakarta” tanpa upgrade plan yang matang.

Rekomendasi pendekatan:

```text
Java 8 + javax stack
  -> stabilkan dependency
  -> tambah test coverage
  -> inventaris JSP/JSF/taglib/custom tags
  -> upgrade container dalam jalur javax dulu bila perlu
  -> baru rancang migration ke jakarta
```

---

### 7.2 Java 11 baseline

| Area | Umum di Java 11 era |
|---|---|
| Platform | Java EE 8 / Jakarta EE 8 / awal Jakarta EE 9 adoption |
| Namespace | `javax.*` atau awal `jakarta.*` |
| Karakter | transisi dari Java 8, modular JDK mulai terasa |
| Risiko | dependency lama memakai removed Java EE modules dari JDK, JAXB/JAX-WS eksternal, reflection warning |

Java 11 penting karena sejak Java 9+, JDK tidak lagi terasa seperti Java 8. Beberapa API enterprise yang dulu terasa “tersedia” perlu dependency eksplisit.

Untuk JSP/Faces, Java 11 sering menjadi tahap stabilisasi sebelum lompat ke Java 17/21.

---

### 7.3 Java 17 baseline

| Area | Umum di Java 17 era |
|---|---|
| Platform | Jakarta EE 10/11 compatible direction |
| Namespace | dominan `jakarta.*` untuk aplikasi baru |
| Karakter | LTS modern, minimum penting untuk banyak runtime baru |
| Risiko | old `javax` libraries tidak cocok, reflection/module encapsulation lebih ketat |

Jakarta EE 11 menetapkan Java SE 17 atau lebih tinggi sebagai baseline minimum. Maka untuk aplikasi Jakarta EE 11, Java 17 adalah minimum modern yang masuk akal.

---

### 7.4 Java 21 baseline

| Area | Umum di Java 21 era |
|---|---|
| Platform | Jakarta EE 10/11 modern runtime |
| Namespace | `jakarta.*` |
| Karakter | LTS modern, virtual threads tersedia sebagai fitur final Java SE |
| Relevansi UI server-side | virtual threads bisa membantu request-per-thread scalability, tetapi tidak otomatis memperbaiki session bloat/component tree overhead |

Java 21 cocok sebagai baseline enterprise modern karena:

- LTS,
- banyak vendor runtime mendukung,
- performa JVM modern,
- virtual threads tersedia,
- cocok dengan platform Jakarta modern.

Namun untuk Pages/Faces, jangan salah kaprah:

```text
Virtual threads reduce thread-blocking cost.
They do not remove:
- bad database query from backing bean,
- huge JSF view state,
- oversized session,
- inefficient component tree,
- XSS risk,
- poor navigation design.
```

---

### 7.5 Java 25 baseline

| Area | Java 25 implication |
|---|---|
| Status | JDK 25 adalah LTS modern setelah JDK 21 |
| Platform fit | cocok untuk runtime yang sudah certified/tested di Java 25 |
| Risiko | container/library support harus diverifikasi, terutama enterprise products |
| Strategi | jangan upgrade production UI stack ke Java 25 hanya karena JDK tersedia; validasi container, Faces implementation, taglib, component library, build plugins |

Java 25 penting untuk horizon 2026+ karena akan menjadi target banyak modernisasi. Tetapi untuk aplikasi Pages/Faces, compatibility runtime lebih penting daripada syntax Java terbaru.

Pertanyaan yang harus dijawab sebelum Java 25 adoption:

1. Apakah container mendukung Java 25 secara resmi?
2. Apakah Faces implementation dites di Java 25?
3. Apakah component library compatible?
4. Apakah bytecode target sesuai?
5. Apakah build plugin lama masih berjalan?
6. Apakah CI/CD image sudah update?
7. Apakah ada illegal reflective access yang berubah menjadi failure?
8. Apakah monitoring/APM agent support Java 25?

---

## 8. Matrix Namespace: `javax` vs `jakarta`

### 8.1 Jangan campur sembarangan

Aturan praktis:

```text
Jika container adalah Java EE/Jakarta EE 8 style -> pakai javax.*
Jika container adalah Jakarta EE 9+ style      -> pakai jakarta.*
```

Campuran berikut berbahaya:

```text
Application code: jakarta.servlet.*
Container API   : javax.servlet.*
```

Atau:

```text
Application code: javax.faces.*
Faces runtime   : jakarta.faces.*
```

Hasilnya bisa berupa:

- `ClassNotFoundException`,
- `NoClassDefFoundError`,
- `ClassCastException`,
- taglib not found,
- listener/filter tidak ter-load,
- CDI bean tidak ditemukan,
- Faces lifecycle error yang terlihat jauh dari akar masalah.

---

### 8.2 Contoh mapping package

| Legacy `javax` | Modern `jakarta` |
|---|---|
| `javax.servlet.*` | `jakarta.servlet.*` |
| `javax.servlet.http.*` | `jakarta.servlet.http.*` |
| `javax.servlet.jsp.*` | `jakarta.servlet.jsp.*` |
| `javax.servlet.jsp.tagext.*` | `jakarta.servlet.jsp.tagext.*` |
| `javax.el.*` | `jakarta.el.*` |
| `javax.faces.*` | `jakarta.faces.*` |
| `javax.enterprise.context.*` | `jakarta.enterprise.context.*` |
| `javax.inject.*` | `jakarta.inject.*` |
| `javax.validation.*` | `jakarta.validation.*` |
| `javax.annotation.*` | `jakarta.annotation.*` |

---

### 8.3 Contoh migration diff sederhana

Before:

```java
package com.example.web;

import javax.faces.view.ViewScoped;
import javax.inject.Named;
import java.io.Serializable;

@Named
@ViewScoped
public class SearchBean implements Serializable {
    private String keyword;

    public String search() {
        return "result";
    }
}
```

After:

```java
package com.example.web;

import jakarta.faces.view.ViewScoped;
import jakarta.inject.Named;
import java.io.Serializable;

@Named
@ViewScoped
public class SearchBean implements Serializable {
    private String keyword;

    public String search() {
        return "result";
    }
}
```

Namun ini hanya permukaan. Yang juga harus dicek:

- `faces-config.xml`,
- `web.xml`,
- Facelets namespace,
- Maven dependencies,
- component library,
- custom converter/validator,
- custom PhaseListener,
- custom taglib,
- deployment container.

---

## 9. Container Compatibility: Jangan Hanya Lihat API

### 9.1 Servlet container vs full Jakarta EE server

Tidak semua runtime sama.

```text
Servlet container:
  - Tomcat
  - Jetty
  - Undertow standalone

Full/Profile Jakarta EE server:
  - GlassFish / Eclipse GlassFish
  - Payara
  - WildFly
  - Open Liberty
  - WebLogic
```

Servlet container biasanya menyediakan:

- Servlet,
- Pages/JSP,
- EL,
- WebSocket tergantung versi,
- bukan full Jakarta EE stack.

Full Jakarta EE server bisa menyediakan:

- CDI,
- Faces,
- Bean Validation,
- Transactions,
- Persistence,
- Security,
- REST,
- dan lain-lain.

Jika kamu deploy Faces ke Tomcat, kamu biasanya perlu membawa implementation/library Faces sendiri. Jika deploy ke full Jakarta EE server, Faces bisa sudah tersedia sebagai bagian server.

---

### 9.2 Tomcat garis besar

| Tomcat | Namespace umum | Catatan |
|---|---|---|
| Tomcat 8.5 | `javax.*` | Java EE era, Servlet 3.1-ish support line |
| Tomcat 9 | `javax.*` | Java EE 8 style, Servlet 4.0 |
| Tomcat 10.0 | `jakarta.*` | Jakarta EE 9 transition |
| Tomcat 10.1 | `jakarta.*` | Jakarta EE 10 aligned, Servlet 6.0 era |
| Tomcat 11 | `jakarta.*` | Jakarta EE 11 aligned direction |

Prinsip:

```text
Tomcat 9  -> javax web apps
Tomcat 10+ -> jakarta web apps
```

Jika aplikasi Spring MVC + JSP lama jalan di Tomcat 9, lalu dipindah ke Tomcat 10 tanpa migrasi namespace, biasanya gagal.

---

### 9.3 Full Jakarta EE server

Untuk Faces, pilihan runtime matters:

- Mojarra biasanya terkait referensi implementation Faces.
- MyFaces adalah implementation alternatif dari Apache.
- Server seperti Payara/GlassFish/WildFly/Open Liberty bisa punya integrasi berbeda.
- Component library seperti PrimeFaces harus cocok dengan JSF/Jakarta Faces major version.

Hal yang harus dipastikan:

1. Versi server mendukung Jakarta EE berapa.
2. Versi Faces implementation apa yang dibundel.
3. Apakah kamu boleh override Faces implementation di aplikasi.
4. Apakah CDI integration berjalan sesuai versi.
5. Apakah component library compatible.
6. Apakah production support tersedia.

---

## 10. Dependency Matrix: API vs Implementation vs Provided Scope

### 10.1 API dependency bukan implementation

Kesalahan umum Maven:

```xml
<dependency>
    <groupId>jakarta.servlet</groupId>
    <artifactId>jakarta.servlet-api</artifactId>
    <version>6.1.0</version>
</dependency>
```

Jika tidak diberi `provided`, artifact API bisa ikut masuk WAR dan bentrok dengan container.

Biasanya untuk container-provided API:

```xml
<dependency>
    <groupId>jakarta.servlet</groupId>
    <artifactId>jakarta.servlet-api</artifactId>
    <version>6.1.0</version>
    <scope>provided</scope>
</dependency>
```

Tapi untuk library yang tidak disediakan container, misalnya JSTL implementation di Tomcat, kamu mungkin perlu include implementation di WAR.

---

### 10.2 Tiga jenis dependency

```text
1. API only
   - interface/classes untuk compile
   - sering provided by container

2. Implementation
   - runtime engine sebenarnya
   - bisa provided by server atau bundled app

3. Component/utility library
   - PrimeFaces, OmniFaces, custom taglib, dsb.
```

Contoh masalah:

```text
Compile berhasil karena API ada.
Runtime gagal karena implementation tidak ada.
```

Atau:

```text
Runtime punya implementation vA.
WAR membawa implementation vB.
Classloader memilih salah satu.
Bug muncul acak.
```

---

### 10.3 Dependency hygiene checklist

Untuk aplikasi Pages/Faces:

```text
[ ] Tidak ada campuran javax dan jakarta untuk API utama.
[ ] Servlet API scope sesuai container.
[ ] JSP/Pages API tidak dibundle jika container sudah menyediakan.
[ ] EL API/implementation tidak bentrok dengan container.
[ ] JSTL API dan implementation cocok.
[ ] Faces implementation tidak dobel.
[ ] Component library cocok dengan Faces major version.
[ ] OmniFaces major version cocok dengan JSF/Jakarta Faces generation.
[ ] Tidak ada transitive dependency lama yang membawa javax.*.
[ ] Dependency tree diperiksa, bukan hanya pom.xml top-level.
```

Command berguna:

```bash
mvn dependency:tree
mvn dependency:tree -Dincludes=javax.*
mvn dependency:tree -Dincludes=jakarta.*
```

Untuk Gradle:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency javax.servlet
./gradlew dependencyInsight --dependency jakarta.servlet
```

---

## 11. Faces Version Matrix: JSF 2.x sampai Jakarta Faces 4.x/5.x

### 11.1 Garis besar generasi

| Generation | Namespace | View utama | Karakter |
|---|---|---|---|
| JSF 2.0–2.2 | `javax.faces.*` | Facelets modern mulai dominan | legacy enterprise banyak di sini |
| JSF 2.3 | `javax.faces.*` | Facelets | integrasi CDI lebih matang |
| Jakarta Server Faces 3.0 | `jakarta.faces.*` | Facelets | namespace migration ke Jakarta EE 9 |
| Jakarta Faces 4.0 | `jakarta.faces.*` | Facelets | Jakarta EE 10 era, cleanup API lama |
| Jakarta Faces 4.1 | `jakarta.faces.*` | Facelets | Jakarta EE 11 era, refinement dan alignment |
| Jakarta Faces 5.0 | `jakarta.faces.*` | Facelets | under development untuk Jakarta EE 12 |

---

### 11.2 Kenapa JSF 2.3 penting?

Banyak aplikasi legacy “modern tapi masih javax” berada di JSF 2.3.

Ciri:

- masih `javax.faces.*`,
- Facelets sudah normal,
- CDI integration lebih baik dibanding era sebelumnya,
- bisa jadi stepping stone sebelum Jakarta migration.

Strategi realistis:

```text
JSF 2.0/2.1 legacy
  -> JSF 2.3 cleanup within javax world
  -> improve CDI usage
  -> remove deprecated managed bean style
  -> add tests
  -> migrate to Jakarta Faces 3/4
```

---

## 12. Taglib URI Matrix

| Purpose | Legacy URI | Jakarta URI |
|---|---|---|
| Core | `http://java.sun.com/jsp/jstl/core` | `jakarta.tags.core` |
| Formatting | `http://java.sun.com/jsp/jstl/fmt` | `jakarta.tags.fmt` |
| Functions | `http://java.sun.com/jsp/jstl/functions` | `jakarta.tags.functions` |
| XML | `http://java.sun.com/jsp/jstl/xml` | `jakarta.tags.xml` |
| SQL | `http://java.sun.com/jsp/jstl/sql` | `jakarta.tags.sql` |

Catatan:

- Banyak aplikasi juga memakai URI `http://xmlns.jcp.org/jsp/jstl/...`.
- Jangan ubah URI tanpa memastikan JSTL implementation cocok.
- Jangan pakai SQL tags untuk desain enterprise baru.

---

## 13. Facelets Namespace Matrix

Legacy/JSF 2.x umum:

```xhtml
xmlns:h="http://xmlns.jcp.org/jsf/html"
xmlns:f="http://xmlns.jcp.org/jsf/core"
xmlns:ui="http://xmlns.jcp.org/jsf/facelets"
xmlns:cc="http://xmlns.jcp.org/jsf/composite"
```

Modern Jakarta Faces style:

```xhtml
xmlns:h="jakarta.faces.html"
xmlns:f="jakarta.faces.core"
xmlns:ui="jakarta.faces.facelets"
xmlns:cc="jakarta.faces.composite"
```

Namun perhatikan:

- Beberapa runtime masih mendukung compatibility alias.
- Component library punya namespace sendiri.
- Migration tool bisa mengganti Java imports tetapi belum tentu semua XML namespace.
- Template lama perlu dicek satu per satu.

---

## 14. Deployment Descriptor dan Schema Migration

Legacy `web.xml` bisa memakai namespace lama.

Contoh pola lama:

```xml
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee"
         version="4.0">
</web-app>
```

Jakarta modern memakai namespace Jakarta.

Yang harus dicek:

- `web.xml`,
- `faces-config.xml`,
- `taglib.tld`,
- custom validator/converter config,
- context-param Faces,
- servlet/filter/listener class names,
- welcome file,
- error page,
- security constraint.

Masalah yang sering terjadi:

```text
Java class imports sudah diganti ke jakarta,
tetapi XML descriptor masih menunjuk class/package lama.
```

Atau:

```text
faces-config version lama masih terbaca,
tetapi behavior default berbeda dari ekspektasi modern.
```

---

## 15. Migration Risk Matrix

| Area | Risiko | Gejala | Mitigasi |
|---|---|---|---|
| Java imports | `javax` tertinggal | compile error atau runtime class not found | automated rewrite + dependency tree |
| Transitive dependency | library lama membawa `javax` | runtime conflict | dependency exclusions / upgrade library |
| Taglib URI | JSTL tidak ditemukan | taglib cannot be resolved | cocokkan URI + implementation |
| TLD custom | package lama di TLD | tag handler class not found | update TLD dan recompile |
| Faces namespace | Facelets tag tidak dikenali | XML/tag error | update namespace atau runtime compatibility |
| Managed bean | legacy JSF annotation | bean tidak resolve | migrasi ke CDI `@Named` |
| View scope | scope berubah/serialization | bean hilang / view expired | audit scope dan serialization |
| Component library | versi tidak compatible | render error / JS error | upgrade major sesuai Faces version |
| EL resolver | custom resolver lama | property not found | port ke `jakarta.el.*` |
| Container | runtime tidak cocok | deployment failure | align server with platform version |
| Build plugin | old JSP compiler | CI failure | upgrade Maven/Gradle plugins |
| Tests | coverage rendah | migration regression | golden master + integration tests |

---

## 16. Decision Framework: Stay, Upgrade, Migrate, or Replace?

Tidak semua aplikasi JSP/Faces harus langsung diganti SPA. Keputusan yang matang mempertimbangkan:

1. Umur aplikasi.
2. Frekuensi perubahan UI.
3. Kompleksitas form dan workflow.
4. Kebutuhan SEO/public pages.
5. Team skill.
6. Security requirement.
7. Accessibility requirement.
8. Integration dengan server-side session.
9. Operational maturity.
10. Budget dan risk appetite.

---

### 16.1 Tetap di `javax` untuk sementara

Masuk akal jika:

- aplikasi stabil,
- perubahan kecil,
- container masih supported,
- library modern Jakarta belum siap,
- tidak ada business case untuk migration besar,
- tim belum punya test coverage.

Tetapi harus punya risk register:

```text
- end of support container
- security patch availability
- developer familiarity declining
- old component library vulnerabilities
- difficult hiring/maintenance
```

---

### 16.2 Upgrade dalam dunia `javax` dulu

Masuk akal jika legacy terlalu tua.

Contoh:

```text
JSF 2.0 + Java 8 + old managed bean
  -> JSF 2.3 + CDI cleanup + tests
  -> prepare Jakarta migration
```

Ini mengurangi risk big bang.

---

### 16.3 Migrasi ke Jakarta

Masuk akal jika:

- container target adalah Jakarta EE 10/11,
- organisasi bergerak ke Java 17/21/25,
- third-party library siap,
- ada kebutuhan security/support,
- test coverage cukup,
- ada waktu regression testing.

Strategi:

```text
Inventory
  -> dependency cleanup
  -> automated namespace rewrite
  -> XML/taglib update
  -> library major upgrade
  -> compile fix
  -> integration test
  -> visual regression
  -> performance/security test
  -> phased rollout
```

---

### 16.4 Replace/strangler ke UI modern

Masuk akal jika:

- UI sangat interaktif,
- JSF state management menjadi bottleneck,
- component library terlalu membatasi,
- frontend team dominan SPA,
- API backend sudah matang,
- business ingin UX modern.

Namun jangan replatform tanpa memahami hidden functionality lama:

- validation rules,
- authorization visibility,
- audit trail side effect,
- workflow transition,
- hidden session assumptions,
- file upload/download behavior,
- i18n,
- accessibility,
- browser compatibility.

Sering kali pilihan terbaik adalah strangler:

```text
Existing JSP/Faces app
  + new REST/BFF endpoints
  + new SPA module per bounded context
  + shared auth/session/SSO strategy
  + gradual cutover
```

---

## 17. Reading Legacy Apps: Investigation Checklist

Saat mendapat aplikasi JSP/JSF lama, jangan langsung refactor. Baca dulu struktur runtime-nya.

### 17.1 File inventory

Cari:

```text
*.jsp
*.jspx
*.xhtml
*.tag
*.tagx
*.tld
web.xml
faces-config.xml
pom.xml / build.gradle
WEB-INF/lib
```

Command contoh:

```bash
find . -name "*.jsp" -o -name "*.jspx" -o -name "*.xhtml" -o -name "*.tag" -o -name "*.tld"
```

---

### 17.2 Scriptlet inventory

```bash
grep -R "<%" -n src/main/webapp
```

Klasifikasi:

```text
<%@ ... %>  directive, normal
<%-- ... --%> comment, normal
<%= ... %> expression, legacy risk
<% ... %>   scriptlet, higher risk
<%! ... %>  declaration, thread-safety risk
```

---

### 17.3 Taglib inventory

```bash
grep -R "taglib" -n src/main/webapp
```

Kelompokkan:

- JSTL core/fmt/functions/xml/sql,
- custom internal taglib,
- framework taglib,
- security taglib,
- old Struts/Spring tags,
- proprietary vendor tags.

---

### 17.4 Faces inventory

Cari:

```bash
grep -R "xmlns:h" -n src/main/webapp
grep -R "javax.faces\|jakarta.faces" -n src/main/java
grep -R "@ManagedBean\|@Named\|@ViewScoped\|@SessionScoped" -n src/main/java
```

Identifikasi:

- JSF managed bean legacy,
- CDI bean modern,
- scope usage,
- converters,
- validators,
- phase listeners,
- custom components,
- navigation rules,
- component library namespace.

---

## 18. Common Failure Patterns Lintas Versi

### 18.1 Aplikasi compile tapi gagal deploy

Kemungkinan:

- API dependency tersedia saat compile, runtime container tidak cocok.
- Deployment descriptor schema/class lama.
- Servlet/filter/listener class masih `javax`.
- WAR membawa JAR API yang bentrok.

Diagnosis:

```text
Check server version.
Check package namespace.
Check dependency tree.
Check WEB-INF/lib.
Check first root cause exception, not last stacktrace.
```

---

### 18.2 JSP jalan, tapi taglib tidak ditemukan

Kemungkinan:

- JSTL implementation tidak ada.
- URI salah generasi.
- TLD tidak terdeteksi.
- Container scan JAR bermasalah.
- Packaging WAR salah.

Diagnosis:

```text
Check taglib URI.
Check JSTL API + impl.
Check container Pages version.
Check WEB-INF/lib contents.
```

---

### 18.3 Faces page render, tapi action tidak terpanggil

Kemungkinan:

- form tidak membungkus command component,
- validation failure menghentikan lifecycle,
- immediate behavior salah,
- component id/naming container salah,
- bean scope salah,
- method expression tidak resolve,
- Ajax execute/render salah.

Diagnosis:

```text
Enable Faces lifecycle logs.
Check validation messages.
Check h:form.
Check browser network request.
Check component tree id.
Check bean scope lifecycle.
```

---

### 18.4 Setelah migration, bean tidak ditemukan

Kemungkinan:

- `@ManagedBean` legacy tidak diproses seperti sebelumnya,
- CDI discovery mode berubah,
- `beans.xml` tidak sesuai,
- package import campur,
- name bean berubah,
- class tidak serializable untuk view scope.

Diagnosis:

```text
Check CDI bootstrap logs.
Check @Named value.
Check beans.xml.
Check imports.
Check scope annotation source.
```

---

### 18.5 ViewExpiredException meningkat setelah upgrade

Kemungkinan:

- state saving default berubah,
- session timeout berbeda,
- view state encryption/signing config berubah,
- clustering/sticky session berubah,
- Ajax requests memakai stale view,
- component tree terlalu besar.

Diagnosis:

```text
Check javax/jakarta.faces.STATE_SAVING_METHOD.
Check number of views in session.
Check session replication.
Check load balancer stickiness.
Check hidden ViewState size.
```

---

## 19. Version Strategy untuk Java 8 sampai 25

### 19.1 Jika masih Java 8

Rekomendasi:

- Jangan target Jakarta EE 11 langsung tanpa staged migration.
- Stabilkan dulu dependency dan tests.
- Inventaris scriptlet/taglib/Faces customizations.
- Upgrade minor/patch library dalam jalur `javax` jika masih supported.
- Rancang migration path ke Java 17/21.

---

### 19.2 Jika sudah Java 11

Rekomendasi:

- Evaluasi apakah stack masih `javax` atau sudah `jakarta`.
- Jangan campur Tomcat 10 dengan aplikasi `javax` tanpa migration.
- Perkuat build reproducibility.
- Siapkan Java 17 sebagai target minimum Jakarta EE 11.

---

### 19.3 Jika target Java 17

Rekomendasi:

- Cocok untuk Jakarta EE 10/11 adoption.
- Pastikan semua library sudah Jakarta-compatible.
- Gunakan tests untuk migration regression.
- Hapus dependency legacy yang tidak perlu.

---

### 19.4 Jika target Java 21

Rekomendasi:

- Cocok untuk modern enterprise baseline.
- Jangan berharap virtual threads menyelesaikan masalah UI state.
- Fokus pada observability, state size, session, dan component tree.
- Validasi container support.

---

### 19.5 Jika target Java 25

Rekomendasi:

- Cocok untuk horizon modernisasi jangka panjang.
- Pastikan vendor/container officially support.
- Pastikan CI/CD, APM, bytecode tools, JSP compiler, annotation processors compatible.
- Uji full regression, bukan hanya compile.

---

## 20. Practical Compatibility Decision Tree

Gunakan decision tree ini saat menentukan stack.

```text
Apakah aplikasi baru?
  |
  +-- Ya
  |    |
  |    +-- Butuh server-side UI sederhana/admin/internal?
  |    |      -> Jakarta EE 11 + Java 21/25-ready runtime + Facelets/Faces atau MVC/JSP minimal
  |    |
  |    +-- Butuh UX sangat interaktif/public product?
  |           -> Pertimbangkan SPA + REST/BFF; server-side UI hanya untuk admin/internal
  |
  +-- Tidak, aplikasi existing
       |
       +-- Masih javax?
       |     |
       |     +-- Container masih supported dan perubahan kecil?
       |     |      -> Maintain + harden + test
       |     |
       |     +-- Perlu upgrade platform/security?
       |            -> Staged migration ke Jakarta
       |
       +-- Sudah jakarta?
             |
             +-- Library/container compatible?
             |      -> Upgrade minor/major terkontrol
             |
             +-- Banyak issue state/performance?
                    -> Review architecture; mungkin strangler sebagian UI
```

---

## 21. Contoh Peta Migrasi Realistis

### 21.1 Kondisi awal

```text
Java 8
Tomcat 9
Spring MVC + JSP
JSTL 1.2
javax.servlet.*
old taglib URI
scriptlet masih ada
```

### 21.2 Target langsung yang salah

```text
Java 25
Tomcat 11
Jakarta Pages 4.x
Jakarta Tags 3.x
Semua import diganti otomatis
Deploy production
```

Risiko:

- terlalu banyak variabel berubah,
- root cause sulit dilacak,
- taglib error,
- dependency conflict,
- behavior regression,
- test gap.

### 21.3 Target staged yang lebih aman

```text
Stage 1: Stabilize legacy
  - Java 8/11 compatible build
  - dependency tree cleanup
  - remove unused libraries
  - add integration tests
  - identify scriptlets/custom tags

Stage 2: Modernize within javax if needed
  - Java 11 or 17 where possible
  - latest compatible javax stack
  - reduce scriptlets
  - move logic from JSP to controller/view model

Stage 3: Jakarta migration
  - automated namespace rewrite
  - update dependencies
  - update taglib URI
  - update descriptors
  - upgrade container
  - run full regression

Stage 4: Runtime modernization
  - Java 21/25 where supported
  - observability
  - security headers
  - performance tuning
```

---

## 22. Special Note: JSP vs Faces Migration Are Different Problems

### 22.1 JSP migration problem

JSP migration biasanya berpusat pada:

- servlet package,
- JSP API,
- taglib URI,
- JSTL dependency,
- custom tag handler,
- generated servlet behavior,
- view model contract.

### 22.2 Faces migration problem

Faces migration lebih kompleks karena ada:

- component tree,
- lifecycle,
- state saving,
- CDI integration,
- converters/validators,
- navigation,
- Ajax partial rendering,
- component library compatibility,
- view scope serialization,
- Facelets namespace.

Maka migration effort Faces hampir selalu lebih besar daripada JSP biasa.

---

## 23. Mental Model Top 1%: Compatibility Is a System Invariant

Engineer biasa melihat compatibility sebagai daftar versi.

Engineer senior melihat compatibility sebagai invariant sistem.

Invariant yang harus dijaga:

```text
All layers that exchange Jakarta EE types must agree on the same namespace generation.
```

Lebih konkret:

```text
Container
API dependency
Implementation
Application code
Descriptors
Taglib URI
Facelets namespace
Third-party libraries
Build plugins
Runtime agents
```

harus berada dalam keluarga kompatibilitas yang sama.

Jika satu layer tertinggal, error bisa muncul jauh dari akar masalah.

Contoh:

```text
Root cause:
  PrimeFaces version masih untuk javax.faces.*

Symptom:
  View render error, missing component class, EL method not found, Ajax JS error
```

Atau:

```text
Root cause:
  JSTL implementation tidak cocok dengan Jakarta Pages runtime

Symptom:
  taglib URI cannot be resolved
```

Atau:

```text
Root cause:
  custom ELResolver masih import javax.el.*

Symptom:
  property binding tidak resolve di halaman tertentu
```

---

## 24. Quick Reference: Recommended Baselines

### 24.1 Legacy maintenance baseline

```text
Java 8/11
Java EE 8 / Jakarta EE 8 style
javax.*
Tomcat 9 or equivalent javax runtime
JSF 2.3 if Faces is used
JSTL 1.2
```

Cocok untuk:

- sistem lama yang stabil,
- maintenance mode,
- migration belum feasible.

Risiko:

- support window,
- security patch,
- hiring familiarity,
- library aging.

---

### 24.2 Modern stable baseline

```text
Java 17/21
Jakarta EE 10/11
jakarta.*
Jakarta Pages 4.x where supported
Jakarta Faces 4.x
Jakarta EL 5/6 depending platform
Jakarta Tags 3.x
```

Cocok untuk:

- modernisasi enterprise,
- new internal apps,
- admin/backoffice UI,
- long-term platform alignment.

---

### 24.3 Forward-looking baseline

```text
Java 25
Jakarta EE 11+ runtime certified/tested on Java 25
jakarta.*
Faces/Pages/Tags versions matching container
```

Cocok untuk:

- platform modernization 2026+,
- organisasi dengan CI/CD dan regression suite kuat,
- runtime vendor support jelas.

---

## 25. Checklist Sebelum Menjawab “Bisa Upgrade?”

Sebelum menjawab apakah aplikasi JSP/Faces bisa upgrade ke Java/Jakarta versi tertentu, jawab ini:

```text
[ ] Runtime sekarang apa?
[ ] Runtime target apa?
[ ] Java sekarang berapa?
[ ] Java target berapa?
[ ] Namespace kode sekarang javax atau jakarta?
[ ] Ada JSP? Berapa banyak?
[ ] Ada scriptlet? Seberapa banyak?
[ ] Ada JSTL? URI mana?
[ ] Ada custom taglib/TLD?
[ ] Ada JSF/Faces? Versi berapa?
[ ] Pakai Facelets atau JSP view lama?
[ ] Pakai component library? Versi berapa?
[ ] Pakai OmniFaces? Versi berapa?
[ ] Ada custom converter/validator/renderer/phase listener?
[ ] CDI integration bagaimana?
[ ] Ada beans.xml?
[ ] Ada test integration/visual regression?
[ ] Ada security regression test?
[ ] Ada performance baseline?
[ ] Ada rollback plan?
```

Jika banyak jawaban “tidak tahu”, maka pekerjaan pertama bukan upgrade. Pekerjaan pertama adalah **inventory and risk discovery**.

---

## 26. Ringkasan

Bagian ini membangun peta evolusi dan kompatibilitas:

1. JSP/Jakarta Pages adalah template engine yang diterjemahkan menjadi servlet.
2. EL adalah expression/binding engine yang dipakai lintas JSP/Faces.
3. JSTL/Jakarta Tags adalah tag library untuk view logic umum.
4. JSF/Jakarta Faces adalah component-based MVC framework dengan lifecycle dan state management.
5. Java EE/Jakarta EE 8 masih memakai `javax.*`.
6. Jakarta EE 9+ memakai `jakarta.*`.
7. Namespace break adalah perubahan binary besar, bukan sekadar rename kosmetik.
8. Java 8–11 sering berada di dunia legacy/transitional.
9. Java 17 adalah baseline minimum penting untuk Jakarta EE 11.
10. Java 21 adalah baseline modern yang sangat masuk akal.
11. Java 25 adalah target modern jangka panjang, tetapi runtime/library support harus diverifikasi.
12. Migration JSP dan Faces berbeda tingkat kompleksitasnya.
13. Compatibility harus dilihat sebagai invariant lintas container, API, implementation, app code, descriptors, taglib, Facelets namespace, dan third-party libraries.

---

## 27. Latihan Pemahaman

### Latihan 1 — Diagnosis Namespace

Sebuah aplikasi memakai:

```text
Tomcat 10.1
JSP files with old JSTL URI
Java code imports javax.servlet.*
Dependency jakarta.servlet-api
```

Pertanyaan:

1. Apa minimal tiga masalah compatibility yang mungkin terjadi?
2. Mana yang compile-time dan mana yang runtime?
3. Apa urutan perbaikannya?

Jawaban yang diharapkan:

- `javax.servlet.*` tidak cocok dengan Tomcat 10.1 yang berada di dunia Jakarta.
- Old JSTL URI tidak cocok jika memakai Jakarta Tags 3.x.
- Dependency/API dan container harus diselaraskan.
- Perbaikan dimulai dari menentukan target platform, lalu namespace rewrite, dependency cleanup, URI taglib update, dan integration test.

---

### Latihan 2 — Migration Strategy

Aplikasi:

```text
Java 8
JSF 2.2
PrimeFaces lama
@ManagedBean
@SessionScoped berat
custom converter
custom PhaseListener
```

Target bisnis:

```text
Upgrade ke Java 21 dan Jakarta EE 11
```

Pertanyaan:

1. Kenapa big bang migration berisiko tinggi?
2. Inventory apa saja yang harus dilakukan?
3. Apa staged migration yang lebih aman?

Jawaban ringkas:

Big bang berisiko karena Java runtime, namespace, Faces version, component library, CDI model, scope behavior, dan custom extension berubah bersamaan. Inventory harus meliputi managed beans, scopes, Facelets, converters, validators, phase listeners, component library, dependency tree, state saving, dan tests. Staged migration lebih aman: stabilisasi legacy, upgrade ke JSF 2.3/CDI bila mungkin, tambah tests, baru migrasi namespace ke Jakarta.

---

### Latihan 3 — Decision Framework

Aplikasi admin internal kecil:

```text
10 halaman
form CRUD sederhana
hanya internal user
backend Java sudah Jakarta EE 11
team backend kuat, frontend SPA team kecil
```

Pertanyaan:

Apakah Jakarta Faces/JSP masih masuk akal?

Jawaban:

Ya, bisa masuk akal jika kebutuhan UX tidak kompleks dan tim ingin delivery cepat dengan server-side rendering. Tetapi desain harus menjaga separation of concerns, security, testability, dan tidak menumpuk business logic di view/backing bean.

---

## 28. Referensi Resmi dan Rekomendasi Bacaan

Gunakan referensi resmi untuk mengecek versi karena compatibility berubah mengikuti release platform dan vendor runtime.

1. Jakarta EE Specifications  
   `https://jakarta.ee/specifications/`

2. Jakarta EE 11 Platform  
   `https://jakarta.ee/specifications/platform/11/`

3. Jakarta Pages 4.0  
   `https://jakarta.ee/specifications/pages/4.0/`

4. Jakarta Faces 4.1  
   `https://jakarta.ee/specifications/faces/4.1/`

5. Jakarta Expression Language 6.0  
   `https://jakarta.ee/specifications/expression-language/6.0/`

6. Jakarta Standard Tag Library / Tags  
   `https://jakarta.ee/specifications/tags/`

7. Jakarta Standard Tag Library 3.0  
   `https://jakarta.ee/specifications/tags/3.0/`

8. Jakarta Servlet, Faces, and Server Pages explained  
   `https://jakarta.ee/learn/specification-guides/servlet-faces-and-server-pages-explained/`

9. OpenJDK JDK 25 Project  
   `https://openjdk.org/projects/jdk/25/`

---

## 29. Penutup

Bagian ini sengaja tidak masuk terlalu dalam ke syntax JSP, EL resolver, tag handler lifecycle, atau Faces lifecycle. Semua itu akan dibahas pada bagian berikutnya.

Tujuan Part 1 adalah membuat kamu punya **peta kompatibilitas**. Tanpa peta ini, pembelajaran JSP/Faces mudah berubah menjadi hafalan tag dan annotation. Dengan peta ini, kamu bisa membaca aplikasi enterprise lama dan modern sebagai sistem runtime yang punya invariant.

Bagian berikutnya:

```text
02-jakarta-pages-jsp-internal-architecture.md
```

Status seri: **belum selesai**.
