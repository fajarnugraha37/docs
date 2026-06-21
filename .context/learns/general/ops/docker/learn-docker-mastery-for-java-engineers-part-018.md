# learn-docker-mastery-for-java-engineers-part-018.md

# Part 018 — Image Supply Chain: Registry, Tags, Digests, SBOM, Signing, Scanning

> Seri: `learn-docker-mastery-for-java-engineers`  
> Part: `018`  
> Fokus: memahami Docker image sebagai artifact supply chain, bukan sekadar hasil `docker build`.

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah membangun fondasi:

- container sebagai proses dengan boundary;
- Docker Engine, daemon, containerd, dan runc;
- image sebagai layer, tag, digest, dan manifest;
- Dockerfile dan BuildKit;
- Java runtime behavior di container;
- Compose, healthcheck, config, secrets, dan security hardening.

Part ini mengubah sudut pandang:

> Docker image bukan hanya “file hasil build”.  
> Docker image adalah artifact supply chain yang akan berpindah dari developer machine, CI runner, registry, staging, production, scanner, audit system, dan incident investigation.

Untuk Java engineer senior, ini penting karena production failure tidak selalu datang dari bug aplikasi. Banyak incident lahir dari:

- image yang berbeda antara staging dan production;
- tag yang diam-diam berubah;
- base image yang mengandung CVE;
- dependency transitive yang tidak terlihat;
- image yang tidak bisa dibuktikan siapa pembuatnya;
- secret yang masuk ke layer;
- rollback yang tidak benar-benar rollback;
- scanner yang membuat tim panik tanpa memahami exploitability;
- CI yang rebuild image per environment sehingga environment tidak lagi menjalankan artifact yang sama.

---

## 1. Mental Model: Docker Image sebagai Artifact Supply Chain

Dalam software delivery klasik, Java engineer biasanya mengenal artifact seperti:

```text
source code -> jar/war -> deploy
```

Dalam Docker-based delivery, rantainya berubah:

```text
source code
  -> dependency resolution
  -> compile/test/package
  -> Docker build
  -> image layers
  -> image manifest
  -> tag
  -> digest
  -> registry push
  -> scan
  -> attest/sign
  -> promote
  -> deploy by digest
  -> observe runtime
```

Yang sering keliru:

```text
"Image saya adalah my-service:1.2.3"
```

Lebih akurat:

```text
"my-service:1.2.3 adalah label mutable yang pada waktu tertentu menunjuk ke manifest digest tertentu,
dan manifest digest itu menunjuk ke config + layer digest tertentu."
```

Dalam production-grade system, identity image sebaiknya berbasis digest, bukan tag.

---

## 2. Vocabulary Penting

| Istilah | Makna Praktis |
|---|---|
| Image | Template immutable untuk membuat container |
| Layer | Diff filesystem yang menjadi bagian image |
| Manifest | Metadata yang menunjuk ke config dan layer image |
| Manifest list / index | Metadata multi-platform yang menunjuk ke image per architecture |
| Tag | Nama manusiawi yang menunjuk ke image/manifest |
| Digest | Hash content-addressed immutable |
| Registry | Server penyimpanan dan distribusi image |
| Repository | Namespace image di registry |
| Push | Upload image ke registry |
| Pull | Download image dari registry |
| SBOM | Software Bill of Materials; daftar komponen dalam artifact |
| CVE | Common Vulnerabilities and Exposures; identifier vulnerability |
| Scanner | Tool yang mencocokkan komponen image dengan vulnerability database |
| Signing | Bukti cryptographic bahwa image/metadata dibuat oleh pihak tertentu |
| Attestation | Metadata tambahan tentang build, SBOM, provenance |
| Provenance | Bukti asal-usul build: siapa, dari mana, proses apa, commit apa |
| Promotion | Memindahkan artifact yang sama dari environment rendah ke tinggi |
| Policy gate | Aturan yang menentukan artifact boleh lanjut atau tidak |

---

## 3. Kenapa Supply Chain Docker Berbeda dari Build Artifact Java Biasa

Sebuah JAR umumnya berisi:

- class aplikasi;
- dependency Java;
- metadata manifest.

Docker image bisa berisi jauh lebih banyak:

- OS packages;
- shell;
- package manager;
- CA certificates;
- timezone database;
- libc;
- JVM;
- native library;
- application JAR;
- config default;
- startup script;
- healthcheck binary;
- debug tools;
- user/group metadata;
- filesystem permission;
- layer history.

Artinya, ketika kamu deploy container Java, kamu bukan hanya deploy kode Java.

Kamu juga deploy:

```text
Linux userland + JVM distribution + OS package set + application artifact + runtime contract
```

Jadi attack surface dan failure surface jauh lebih luas daripada sekadar Maven dependency.

---

## 4. Registry sebagai Artifact Distribution System

Registry adalah tempat image disimpan dan didistribusikan.

Contoh registry:

```text
docker.io
ghcr.io
registry.gitlab.com
public.ecr.aws
<aws-account-id>.dkr.ecr.<region>.amazonaws.com
<region>-docker.pkg.dev
<azure>.azurecr.io
registry.internal.company.local
```

Contoh image reference:

```text
docker.io/library/postgres:16
ghcr.io/acme/payment-service:1.8.4
registry.internal/acme/case-service:2026.06.21-abc1234
```

Struktur umum:

```text
[registry-host]/[namespace-or-project]/[repository]:[tag]
```

Contoh:

```text
registry.internal.example.com/regulatory/case-management-service:1.14.7
```

Komponen:

```text
registry.internal.example.com    -> registry
regulatory                       -> namespace/project
case-management-service          -> repository
1.14.7                           -> tag
```

---

## 5. Tag: Nama yang Berguna, Tetapi Bukan Identitas Final

Tag sangat berguna untuk manusia:

```text
payment-service:1.2.3
payment-service:main
payment-service:release-2026-06-21
payment-service:sha-9f1a2bc
payment-service:prod
payment-service:latest
```

Tetapi tag pada dasarnya adalah pointer.

Masalahnya:

> Pointer bisa dipindahkan.

Contoh:

```bash
docker build -t registry.example.com/acme/payment-service:1.2.3 .
docker push registry.example.com/acme/payment-service:1.2.3
```

Besok seseorang melakukan:

```bash
docker build -t registry.example.com/acme/payment-service:1.2.3 .
docker push registry.example.com/acme/payment-service:1.2.3
```

Sekarang tag yang sama bisa menunjuk image berbeda.

Dari perspektif audit:

```text
"Production menjalankan payment-service:1.2.3"
```

belum cukup.

Yang dibutuhkan:

```text
"Production menjalankan registry.example.com/acme/payment-service@sha256:..."
```

---

## 6. Digest: Identitas Immutable Berbasis Konten

Digest adalah hash cryptographic dari content image/manifest.

Contoh:

```text
registry.example.com/acme/payment-service@sha256:7a9c...
```

Digest menjawab:

> “Artifact tepat mana yang dipakai?”

Bukan:

> “Nama artifact apa yang dipakai?”

Docker documentation menjelaskan bahwa digest adalah identifier cryptographic unik dari image dan berbeda dari tag yang bisa berubah. Dengan pull by digest, kita meminta versi image yang tepat.

Contoh pull by digest:

```bash
docker pull registry.example.com/acme/payment-service@sha256:7a9c...
```

Keunggulan digest:

- immutable;
- cocok untuk audit;
- cocok untuk rollback;
- cocok untuk deployment reproducibility;
- mengurangi risiko mutable tag;
- memastikan staging dan production menjalankan artifact yang sama.

Kekurangan digest:

- tidak nyaman untuk manusia;
- panjang;
- tidak menjelaskan versi bisnis;
- perlu metadata tambahan agar mudah dilacak.

Solusi production-grade:

```text
gunakan tag untuk readability,
gunakan digest untuk identity.
```

---

## 7. Tag Strategy untuk Java Service

Tag yang baik membantu manusia, automation, dan audit.

### 7.1 Tag yang Umum Dipakai

| Tag | Contoh | Kegunaan |
|---|---|---|
| Semantic version | `1.8.4` | Release formal |
| Git SHA | `sha-9f1a2bc` | Trace ke commit |
| Build number | `build-1842` | Trace ke CI run |
| Branch | `main`, `develop` | Dev/testing convenience |
| Date | `2026.06.21` | Release chronology |
| Environment | `prod`, `staging` | Biasanya anti-pattern |
| latest | `latest` | Convenience, berbahaya untuk production |

### 7.2 Tag yang Disarankan

Untuk Java service:

```text
registry.example.com/acme/case-service:1.14.7
registry.example.com/acme/case-service:sha-9f1a2bc
registry.example.com/acme/case-service:build-1842
```

Semua tag itu boleh menunjuk ke digest yang sama.

Contoh:

```text
case-service:1.14.7      -> sha256:aaa...
case-service:sha-9f1a2bc -> sha256:aaa...
case-service:build-1842  -> sha256:aaa...
```

### 7.3 Tag yang Harus Dihindari untuk Production Deployment

```text
latest
main
staging
prod
stable
current
```

Bukan berarti tidak boleh ada. Tetapi jangan jadikan itu identitas deployment production.

Masalah `prod` tag:

```text
prod hari ini  -> sha256:aaa...
prod besok     -> sha256:bbb...
```

Kalau incident terjadi, log deployment yang hanya menyimpan `prod` tidak cukup untuk forensic.

---

## 8. Build Once, Promote the Same Digest

Prinsip penting:

> Build once. Promote the same artifact. Do not rebuild per environment.

Anti-pattern:

```text
commit abc123
  -> build image for dev
  -> build image for staging
  -> build image for prod
```

Walaupun source code sama, hasil build bisa berbeda karena:

- base image tag berubah;
- dependency repository berubah;
- timestamp build berbeda;
- plugin build berubah;
- package mirror berubah;
- cache berbeda;
- environment variable berbeda;
- architecture berbeda;
- CI runner berbeda.

Pattern yang lebih benar:

```text
commit abc123
  -> build image once
  -> push digest sha256:aaa
  -> deploy sha256:aaa to dev
  -> promote sha256:aaa to staging
  -> promote sha256:aaa to prod
```

Dengan ini, pertanyaan audit menjadi mudah:

```text
Apakah production menjalankan artifact yang sama dengan staging?
Ya, digest sama.
```

---

## 9. Environment-Specific Config Tidak Boleh Membuat Image Berbeda

Salah satu jebakan Docker:

```Dockerfile
ARG ENVIRONMENT=prod
COPY application-prod.yml /app/application.yml
```

Atau:

```Dockerfile
RUN if [ "$ENVIRONMENT" = "prod" ]; then ...
```

Ini menyebabkan satu source code menghasilkan image berbeda per environment.

Lebih baik:

```text
same image + runtime config berbeda
```

Contoh:

```bash
docker run \
  -e SPRING_PROFILES_ACTIVE=prod \
  -e DB_HOST=prod-db.internal \
  registry.example.com/acme/case-service@sha256:aaa...
```

Atau mount config:

```bash
docker run \
  --mount type=bind,src=/etc/case-service/application.yml,dst=/app/config/application.yml,readonly \
  registry.example.com/acme/case-service@sha256:aaa...
```

Image harus menjawab:

```text
Apa aplikasi dan runtime-nya?
```

Runtime config menjawab:

```text
Di environment mana aplikasi ini berjalan?
```

---

## 10. Image Repository Layout

Untuk organisasi besar, repository layout penting.

### 10.1 Layout Berdasarkan Service

```text
registry.example.com/regulatory/case-service
registry.example.com/regulatory/enforcement-service
registry.example.com/regulatory/document-service
registry.example.com/regulatory/notification-service
```

Cocok jika:

- tiap service punya lifecycle sendiri;
- ownership service jelas;
- release independent.

### 10.2 Layout Berdasarkan Domain

```text
registry.example.com/case-management/case-api
registry.example.com/case-management/case-worker
registry.example.com/enforcement/enforcement-api
registry.example.com/enforcement/escalation-worker
```

Cocok untuk domain/platform besar.

### 10.3 Layout Berdasarkan Runtime Type

```text
registry.example.com/java/spring-boot-base
registry.example.com/java/batch-worker-base
registry.example.com/java/debug-tools
```

Ini biasanya untuk base image internal, bukan service application image.

---

## 11. Base Image sebagai Dependency Supply Chain

Base image bukan “FROM line saja”. Base image adalah dependency production.

Contoh:

```Dockerfile
FROM eclipse-temurin:21-jre
```

Dependency kamu sekarang termasuk:

- OS distribution;
- JVM distribution;
- CA bundle;
- libc;
- package manager metadata;
- default userland tools;
- image maintainer update policy;
- vulnerability patch cadence.

Kalau base image berubah, image final berubah.

Tag seperti:

```Dockerfile
FROM eclipse-temurin:21-jre
```

lebih reproducible daripada:

```Dockerfile
FROM eclipse-temurin:latest
```

Namun masih tag.

Untuk production-grade reproducibility, kamu bisa pin digest:

```Dockerfile
FROM eclipse-temurin:21-jre@sha256:<digest>
```

Trade-off:

| Approach | Pros | Cons |
|---|---|---|
| Floating tag | otomatis mendapat update | build tidak fully reproducible |
| Version tag | lebih stabil | masih bisa berubah jika tag dipublish ulang |
| Digest pin | paling reproducible | perlu proses update terkontrol |
| Internal base image | governance kuat | butuh maintenance tim platform |

---

## 12. Internal Base Image: Kapan Masuk Akal?

Organisasi kadang membuat base image internal:

```Dockerfile
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates tzdata
COPY company-ca.crt /usr/local/share/ca-certificates/
RUN update-ca-certificates
```

Lalu service menggunakan:

```Dockerfile
FROM registry.example.com/platform/java21-runtime:2026.06.01
```

Ini berguna jika perusahaan butuh:

- corporate CA;
- timezone standard;
- non-root user standard;
- security baseline;
- approved JVM distribution;
- approved package repository;
- consistent vulnerability management;
- scanner exception policy;
- compliance metadata.

Risikonya:

- tim platform harus patch base image;
- service bisa tertinggal jika tidak rebuild;
- base image internal bisa menjadi single point of outdated dependencies;
- terlalu banyak base image variasi membuat governance sulit.

Prinsip:

> Internal base image boleh, tetapi harus diperlakukan sebagai product dengan owner, changelog, versioning, patch cadence, dan deprecation policy.

---

## 13. SBOM: Software Bill of Materials

SBOM adalah daftar komponen software dalam artifact.

Untuk Docker image, SBOM bisa mencakup:

- OS packages;
- Java runtime packages;
- Maven/Gradle dependencies;
- application artifacts;
- licenses;
- package versions;
- package identifiers.

Docker Scout documentation menjelaskan bahwa Scout menganalisis image, menyusun inventory komponen atau SBOM, lalu mencocokkannya dengan vulnerability database yang terus diperbarui.

SBOM menjawab:

```text
Apa yang ada di dalam image ini?
```

Bukan:

```text
Apakah image ini aman?
```

SBOM adalah input untuk:

- vulnerability scanning;
- license compliance;
- audit;
- incident response;
- dependency inventory;
- provenance verification.

---

## 14. Kenapa SBOM Penting untuk Java Engineer

Java ecosystem punya dependency graph yang dalam:

```text
spring-boot-starter-web
  -> spring-web
  -> spring-core
  -> jackson
  -> tomcat
  -> micrometer
  -> ...
```

Selain itu Docker image juga punya OS packages:

```text
glibc
openssl
ca-certificates
zlib
libstdc++
tzdata
```

Tanpa SBOM, saat vulnerability besar muncul, tim bertanya:

```text
Apakah service kita memakai library X versi Y?
```

Dengan SBOM, pertanyaan menjadi searchable.

Contoh incident workflow:

```text
CVE baru diumumkan untuk library X
  -> query SBOM registry
  -> temukan image digest terdampak
  -> mapping digest ke deployment
  -> tentukan service/environment impacted
  -> patch/rebuild/promote
```

Tanpa SBOM, workflow berubah menjadi manual grep di repo, dependency tree, dan Dockerfile, yang sering tidak akurat.

---

## 15. Cara Generate SBOM

Dengan Docker Scout:

```bash
docker scout sbom registry.example.com/acme/case-service:1.14.7
```

Contoh format output:

```bash
docker scout sbom \
  --format spdx \
  registry.example.com/acme/case-service:1.14.7
```

Dengan BuildKit/buildx, build bisa menghasilkan SBOM attestation:

```bash
docker buildx build \
  --sbom=true \
  --provenance=true \
  -t registry.example.com/acme/case-service:1.14.7 \
  --push .
```

Untuk mode provenance lebih lengkap:

```bash
docker buildx build \
  --sbom=true \
  --provenance=mode=max \
  -t registry.example.com/acme/case-service:1.14.7 \
  --push .
```

Catatan:

- SBOM yang dibuat setelah image selesai berguna.
- SBOM attestation yang melekat pada image lebih berguna untuk supply chain.
- SBOM perlu disimpan bersama artifact atau bisa direferensikan dari registry/attestation store.
- SBOM tanpa digest mapping kehilangan nilai audit.

---

## 16. Vulnerability Scanning: Apa yang Sebenarnya Dilakukan Scanner

Scanner biasanya bekerja seperti ini:

```text
image
  -> extract package metadata
  -> generate component inventory
  -> match package name/version with vulnerability database
  -> produce findings
```

Scanner tidak selalu tahu:

- apakah vulnerable code path dipakai;
- apakah package reachable dari aplikasi;
- apakah mitigasi sudah diterapkan;
- apakah exploit butuh local access;
- apakah container hardening mengurangi exploitability;
- apakah package hanya ada di build stage atau runtime stage.

Karena itu hasil scanner harus dibaca sebagai risk signal, bukan kebenaran absolut.

---

## 17. Tipe Finding Scanner

| Tipe | Contoh | Respons |
|---|---|---|
| OS package CVE | OpenSSL vulnerable | Update base image/package |
| JVM CVE | JDK/JRE issue | Update JVM image |
| Java dependency CVE | Jackson/Spring/Tomcat | Update dependency |
| Transitive dependency CVE | Library transitif | Override/exclude/update parent |
| False positive | Package terdeteksi tapi tidak reachable | Document exception |
| No fixed version | CVE ada tapi upstream belum patch | Mitigate/monitor/exception |
| Build-only package | Maven/git/curl ada di final image | Fix Dockerfile multi-stage |
| License issue | GPL/AGPL package | Legal/compliance review |

---

## 18. CVE Severity Tidak Sama dengan Business Risk

Scanner mungkin memberi:

```text
CRITICAL CVE
```

Tapi engineering decision harus mempertimbangkan:

- exploit vector;
- network exposure;
- authentication requirement;
- privilege requirement;
- vulnerable function used atau tidak;
- package present di runtime atau hanya build-time;
- container running as root atau non-root;
- read-only filesystem atau tidak;
- capability dropped atau tidak;
- service internet-facing atau internal;
- compensating controls;
- patch availability;
- regression risk.

Contoh:

```text
Critical CVE di package shell yang ada dalam image distroless? 
Mungkin tidak ada shell.

High CVE di library parsing XML yang tidak pernah dipakai?
Tetap perlu dicatat, tetapi urgensi berbeda.

Medium CVE di TLS library pada internet-facing service?
Bisa lebih penting dari high CVE yang tidak reachable.
```

Prinsip:

> Scanner menghasilkan findings. Engineer menghasilkan risk decision.

---

## 19. Scanner Policy yang Masuk Akal

Policy yang buruk:

```text
Fail build jika ada CVE high/critical apa pun.
```

Akibat:

- pipeline sering merah;
- developer terbiasa mengabaikan scanner;
- exception liar;
- patch tanpa risk analysis;
- delivery macet karena issue yang tidak exploitable.

Policy yang lebih matang:

```text
Fail jika:
- critical/high memiliki fix tersedia dan berada di runtime image;
- vulnerability reachable atau pada exposed component;
- base image tertinggal dari approved baseline;
- package dilarang oleh policy;
- SBOM/provenance tidak ada;
- image berjalan sebagai root tanpa exception;
- tag mutable digunakan untuk production deployment.
```

Dengan exception process:

```text
exception must include:
- CVE ID
- affected package
- affected image digest
- reason
- compensating control
- expiry date
- owner
```

Exception tanpa expiry adalah technical debt permanen.

---

## 20. Build Stage vs Runtime Stage dalam Scanning

Misal Dockerfile:

```Dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/app.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Build stage berisi:

- Maven;
- compiler;
- banyak dependency cache;
- mungkin git/curl/shell.

Runtime stage hanya butuh:

- JRE;
- app.jar;
- CA cert;
- timezone data bila perlu.

Scanner sebaiknya fokus pada final runtime image untuk production risk.

Tetapi build environment juga tetap penting untuk supply chain:

- build tool bisa compromised;
- plugin Maven bisa malicious;
- dependency download bisa disusupi;
- secret bisa bocor saat build.

Jadi ada dua pertanyaan berbeda:

```text
Apakah runtime image aman?
Apakah build process trustworthy?
```

---

## 21. Signing: Bukti Publisher dan Integrity

Signing memberi bukti cryptographic bahwa artifact/metadata ditandatangani oleh identity tertentu.

Docker Content Trust historically menyediakan digital signature untuk data yang dikirim ke dan diterima dari remote registry, memungkinkan client-side atau runtime verification atas integrity dan publisher image tag.

Namun dalam ekosistem modern, signing sering dibahas bersama:

- Notary;
- Sigstore/cosign;
- in-toto attestations;
- SLSA provenance;
- OCI artifact attestations.

Tujuan signing:

```text
"Apakah image ini benar dibuat/dipublish oleh pihak yang kita percaya?"
```

Bukan:

```text
"Apakah image ini bebas vulnerability?"
```

Image signed tetap bisa mengandung CVE atau bug.

Signing menjawab trust in origin, bukan safety in content.

---

## 22. Provenance: Bukti Asal-Usul Build

Provenance menjawab:

- image ini dibangun dari repository mana?
- commit apa?
- workflow CI mana?
- builder apa?
- kapan dibangun?
- oleh identity apa?
- parameter build apa?
- source material apa?

Docker documentation mendefinisikan image provenance sebagai metadata untuk melacak origin, authorship, dan integrity image, menjawab pertanyaan seperti asal image, siapa yang membangunnya, dan apakah image sudah diubah.

Contoh build dengan provenance:

```bash
docker buildx build \
  --provenance=true \
  --sbom=true \
  -t registry.example.com/acme/case-service:1.14.7 \
  --push .
```

Provenance penting untuk:

- audit;
- incident response;
- deployment approval;
- detecting unauthorized builds;
- verifying build came from CI, not laptop;
- mapping image digest ke commit;
- preventing artifact substitution.

---

## 23. Attestation: Metadata yang Menempel pada Artifact

Attestation adalah statement metadata tentang artifact.

Contoh attestation:

```text
This image digest sha256:aaa
was built by GitHub Actions workflow X
from repository Y
at commit Z
with builder B
and contains SBOM S.
```

Attestation bisa mencakup:

- SBOM;
- provenance;
- vulnerability exception;
- policy evaluation result;
- test result;
- signature;
- license report.

Supply chain matang tidak hanya bertanya:

```text
Image apa ini?
```

Tetapi:

```text
Apa bukti yang melekat pada image ini?
```

---

## 24. OCI Labels untuk Traceability

Tambahkan metadata standar ke image.

Contoh Dockerfile:

```Dockerfile
LABEL org.opencontainers.image.title="case-service"
LABEL org.opencontainers.image.description="Regulatory case management service"
LABEL org.opencontainers.image.source="https://git.example.com/regulatory/case-service"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.created="${BUILD_CREATED}"
```

Namun hati-hati:

```Dockerfile
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
```

membutuhkan `ARG`:

```Dockerfile
ARG GIT_COMMIT
ARG APP_VERSION
ARG BUILD_CREATED

LABEL org.opencontainers.image.revision=$GIT_COMMIT
LABEL org.opencontainers.image.version=$APP_VERSION
LABEL org.opencontainers.image.created=$BUILD_CREATED
```

Build:

```bash
docker build \
  --build-arg GIT_COMMIT="$(git rev-parse HEAD)" \
  --build-arg APP_VERSION="1.14.7" \
  --build-arg BUILD_CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -t registry.example.com/acme/case-service:1.14.7 .
```

Catatan penting:

- label bukan security control;
- label bisa dipalsukan jika builder tidak trusted;
- label berguna untuk human traceability;
- provenance/signing memberi bukti lebih kuat.

---

## 25. Registry Access Control

Registry harus diperlakukan sebagai critical system.

Pertanyaan desain:

- siapa boleh push?
- siapa boleh pull?
- siapa boleh delete?
- siapa boleh overwrite tag?
- apakah tag immutable?
- apakah production hanya pull dari approved registry?
- apakah CI credential scoped minimal?
- apakah developer boleh push production namespace?
- apakah registry audit log aktif?
- apakah image retention policy jelas?

Anti-pattern:

```text
Semua developer bisa push ke registry production.
```

Lebih baik:

```text
Developer -> source repo
CI -> build/push to dev namespace
Release pipeline -> promote to production namespace
Runtime cluster/host -> pull-only
```

Credential separation:

| Actor | Permission |
|---|---|
| Developer local | pull dev/base images, maybe push sandbox |
| CI build | push service build namespace |
| Security scanner | pull/read metadata |
| Deployment runtime | pull approved images |
| Release automation | promote/copy digest |
| Human admin | emergency only |

---

## 26. Tag Immutability Policy

Jika registry mendukung tag immutability, aktifkan untuk release tags.

Policy contoh:

```text
Immutable:
- semver tags: 1.14.7
- release tags: release-2026-06-21
- git SHA tags: sha-9f1a2bc
Mutable:
- main
- develop
- latest-dev
- pr-123
```

Mengapa?

Release tag seharusnya tidak berubah. Kalau butuh fix:

```text
1.14.7 -> tetap
1.14.8 -> fix baru
```

Jangan overwrite:

```text
1.14.7 -> digest baru
```

karena itu merusak audit trail.

---

## 27. Image Promotion Strategy

Ada dua model umum.

### 27.1 Retag Promotion

```text
registry/app:sha-abc123
  -> registry/app:staging-approved
  -> registry/app:prod-approved
```

Kekurangan:

- tag mutable;
- masih perlu digest tracking;
- bisa ambigu jika tag berubah.

### 27.2 Digest Promotion

```text
promote sha256:aaa from candidate to staging
promote sha256:aaa from staging to prod
```

Bisa dilakukan dengan:

- registry copy;
- metadata approval;
- deployment manifest update;
- release record referencing digest.

Lebih baik:

```text
Environment approval points to digest.
```

Contoh release record:

```yaml
service: case-service
version: 1.14.7
git_commit: 9f1a2bc
image:
  repository: registry.example.com/regulatory/case-service
  tag: 1.14.7
  digest: sha256:aaa...
sbom: attached
provenance: attached
scanner_status: approved
approved_by: release-manager
approved_at: 2026-06-21T10:15:00Z
```

---

## 28. Rollback dengan Digest

Rollback yang buruk:

```bash
docker run registry.example.com/acme/case-service:previous
```

Rollback yang baik:

```bash
docker run registry.example.com/acme/case-service@sha256:oldgood...
```

Release system harus menyimpan:

- service;
- environment;
- previous digest;
- current digest;
- deployment time;
- config version;
- database migration version;
- rollback eligibility.

Catatan:

> Docker image rollback tidak otomatis berarti application rollback aman.

Untuk Java service, rollback bisa gagal karena:

- database migration sudah forward-only;
- message schema berubah;
- cache format berubah;
- external API contract berubah;
- background worker sudah memproses data versi baru.

Jadi image digest adalah necessary condition untuk rollback, bukan sufficient condition.

---

## 29. Image Retention Policy

Registry tidak boleh dibiarkan tumbuh tanpa batas.

Tetapi jangan hapus artifact yang masih dibutuhkan audit/rollback.

Policy yang masuk akal:

```text
Keep:
- all production digests for N months/years
- all active staging digests
- latest successful build per branch
- last K PR images
- all images linked to open incident
- all images linked to compliance release
Delete:
- failed temporary build image
- unreferenced PR image after PR closed + grace period
- old branch images after branch deleted
```

Yang harus dihindari:

```text
delete untagged images blindly
```

Karena digest production bisa menjadi “untagged” jika promotion system memakai digest reference dan tag sudah berubah/hilang.

---

## 30. Secret Leakage di Image Supply Chain

Secret bisa bocor lewat:

- Dockerfile `ARG`;
- Dockerfile `ENV`;
- `RUN echo secret`;
- copied config file;
- `.env` masuk build context;
- `.m2/settings.xml` masuk image;
- Gradle credentials;
- npm token;
- private key;
- build logs;
- image history;
- layer content;
- SBOM metadata terlalu detail;
- label;
- provenance metadata.

Contoh buruk:

```Dockerfile
ARG MAVEN_TOKEN
RUN mvn -Dtoken=$MAVEN_TOKEN package
```

Walaupun final file tidak mengandung token, token bisa muncul di build history/log.

Lebih baik dengan BuildKit secret:

```Dockerfile
# syntax=docker/dockerfile:1.7
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN --mount=type=secret,id=maven_settings,target=/root/.m2/settings.xml \
    mvn -B package
```

Build:

```bash
docker buildx build \
  --secret id=maven_settings,src="$HOME/.m2/settings.xml" \
  -t registry.example.com/acme/case-service:1.14.7 .
```

Prinsip:

> Secret dibutuhkan saat build boleh di-mount sementara, tetapi tidak boleh menjadi bagian image layer.

---

## 31. Maven/Gradle Dependency Supply Chain

Untuk Java, image supply chain bergantung pada dependency supply chain.

Risiko:

- dependency confusion;
- malicious transitive dependency;
- compromised Maven plugin;
- repository mirror hijack;
- unpinned plugin version;
- snapshot dependency;
- local cache contaminated;
- private registry credential leak.

Praktik yang membantu:

- hindari `SNAPSHOT` untuk release;
- pin plugin versions;
- gunakan dependency lock bila relevan;
- gunakan internal artifact proxy;
- checksum verification;
- repository allowlist;
- separate release repo dan snapshot repo;
- CI clean environment;
- SBOM untuk Java dependencies;
- signed artifacts jika ecosystem mendukung;
- scanner untuk Maven dependencies.

Contoh Maven anti-pattern:

```xml
<version>LATEST</version>
```

Atau:

```xml
<version>[1.0,)</version>
```

Untuk release, gunakan versi eksplisit.

---

## 32. Base Image Update Cadence

Digest pinning membuat build reproducible, tetapi ada konsekuensi:

```text
Pinned digest tidak otomatis mendapat patch security.
```

Karena itu perlu proses update.

Contoh cadence:

```text
Daily:
- scan existing image digests
- alert if critical fix available

Weekly:
- rebuild service images with latest approved base digest
- run tests
- promote if safe

Emergency:
- trigger base image rebuild for critical CVE
- fan-out rebuild dependent services
```

Untuk service Java, update bisa meliputi:

- base OS package;
- JVM patch;
- CA certificate;
- timezone database;
- glibc/musl;
- OpenSSL.

Jangan anggap service aman hanya karena application code tidak berubah.

---

## 33. Rebuild vs Rebase

Saat base image punya patch, ada beberapa strategi.

### 33.1 Full Rebuild

```text
source + dependencies + Docker build ulang
```

Pros:

- simple;
- reproducible via CI;
- tests run normally.

Cons:

- bisa menarik dependency baru jika tidak locked;
- butuh waktu.

### 33.2 Rebase Image Layer

Beberapa tooling mendukung mengganti base layer tanpa rebuild penuh.

Pros:

- cepat;
- bisa patch base.

Cons:

- butuh tooling dan confidence tinggi;
- harus tetap test;
- tidak semua image cocok;
- audit harus jelas.

Untuk mayoritas Java team:

```text
full rebuild + test + same pipeline
```

lebih mudah dipahami dan diaudit.

---

## 34. Multi-Platform Supply Chain

Jika image multi-platform:

```text
case-service:1.14.7
  -> linux/amd64 digest A
  -> linux/arm64 digest B
```

Tag yang sama menunjuk manifest list.

Implikasi:

- digest tag-level bisa menunjuk manifest list;
- per-platform digest berbeda;
- vulnerability bisa berbeda antar platform;
- base image amd64 dan arm64 bisa punya package set berbeda;
- native library Java bisa bermasalah di salah satu platform.

Untuk audit, simpan:

```text
image index digest
platform-specific digest
runtime platform
```

Contoh:

```text
case-service:1.14.7
index digest: sha256:index...
linux/amd64 digest: sha256:amd...
linux/arm64 digest: sha256:arm...
```

Jika production hanya amd64, scanner finding arm64 mungkin kurang relevan untuk runtime production, tetapi tetap relevan jika image dipakai di arm64 dev/CI.

---

## 35. Private Registry Mirror dan Air-Gapped Environment

Di enterprise/regulatory environment, production mungkin tidak boleh pull dari internet.

Pattern:

```text
public upstream registry
  -> approved mirror
  -> internal registry
  -> production runtime
```

Manfaat:

- availability;
- audit;
- control;
- vulnerability scanning;
- legal review;
- provenance policy;
- prevent surprise upstream deletion;
- reduce supply chain attack surface.

Tetapi mirror juga punya risiko:

- stale images;
- unpatched base;
- unclear ownership;
- exception tidak terdokumentasi;
- drift dari upstream.

Policy mirror harus menjawab:

- image apa yang boleh dimirror?
- siapa approval?
- kapan sync?
- bagaimana patch emergency?
- bagaimana delete/deprecate?
- bagaimana mapping upstream digest ke internal digest?

---

## 36. Image Trust Boundary

Jangan semua image dianggap sama.

Trust tiers:

| Tier | Contoh | Policy |
|---|---|---|
| Public random | random Docker Hub image | Jangan production |
| Official/vendor | official postgres, temurin | Review dan pin |
| Hardened vendor | distroless, DHI, Chainguard | Review license/support |
| Internal base | company/java21-runtime | Platform-owned |
| Internal app | case-service | CI-owned |
| Local dev image | developer machine | Tidak untuk prod |

Aturan:

```text
Production hanya boleh menjalankan image dari registry dan namespace approved.
```

Jangan:

```bash
docker run someuser/random-image:latest
```

di environment sensitif.

---

## 37. Docker Hub Rate Limit dan Availability Risk

Jika CI/production langsung pull public images, kamu punya dependency eksternal runtime/build.

Risiko:

- rate limit;
- outage;
- tag deletion;
- upstream compromise;
- unexpected image update;
- legal/compliance issue.

Mitigasi:

- internal cache/mirror;
- pin digest;
- pre-pull approved image;
- use private registry;
- maintain base image bill of materials;
- CI cache;
- documented fallback.

---

## 38. Registry Garbage Collection dan Digest Safety

Image storage terdiri dari blobs/layers/manifests.

Tag deletion tidak selalu langsung menghapus blob. Registry garbage collection bisa menghapus unreferenced blobs.

Risiko:

```text
Deployment masih mereferensikan digest, tetapi registry GC menghapus manifest/blob karena tidak ada tag.
```

Mitigasi:

- release records harus membuat image tetap retained;
- production digests harus protected;
- jangan mengandalkan tag saja;
- jangan hapus untagged image tanpa tahu reference eksternal;
- registry lifecycle policy harus aware terhadap deployment state.

---

## 39. Practical CI/CD Flow untuk Java Docker Image

Contoh flow matang:

```text
1. Developer push commit
2. CI checkout source
3. CI run unit tests
4. CI build JAR
5. CI build image with BuildKit
6. CI generate SBOM + provenance
7. CI tag image with:
   - version
   - git SHA
   - build number
8. CI push image
9. CI capture digest
10. Scanner evaluates digest
11. Policy gate approves/rejects
12. Release record created
13. Dev deploy by digest
14. Staging promote same digest
15. Prod promote same digest
16. Runtime inventory records service -> digest
17. Monitoring/incident tools can map digest -> source/provenance/SBOM
```

---

## 40. Example: Production-Grade Build Command

```bash
APP_NAME="case-service"
APP_VERSION="1.14.7"
GIT_COMMIT="$(git rev-parse HEAD)"
BUILD_CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
IMAGE="registry.example.com/regulatory/${APP_NAME}"

docker buildx build \
  --platform linux/amd64 \
  --build-arg APP_VERSION="${APP_VERSION}" \
  --build-arg GIT_COMMIT="${GIT_COMMIT}" \
  --build-arg BUILD_CREATED="${BUILD_CREATED}" \
  --label "org.opencontainers.image.title=${APP_NAME}" \
  --label "org.opencontainers.image.version=${APP_VERSION}" \
  --label "org.opencontainers.image.revision=${GIT_COMMIT}" \
  --label "org.opencontainers.image.created=${BUILD_CREATED}" \
  --tag "${IMAGE}:${APP_VERSION}" \
  --tag "${IMAGE}:sha-${GIT_COMMIT:0:12}" \
  --tag "${IMAGE}:build-${CI_PIPELINE_ID}" \
  --sbom=true \
  --provenance=mode=max \
  --push \
  .
```

Ambil digest:

```bash
docker buildx imagetools inspect "${IMAGE}:${APP_VERSION}"
```

Atau dari output CI action/build tool.

Release record harus menyimpan digest, bukan hanya tag.

---

## 41. Example: Dockerfile dengan Traceability Label

```Dockerfile
# syntax=docker/dockerfile:1.7

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src

COPY pom.xml .
COPY src ./src

RUN --mount=type=cache,target=/root/.m2 \
    mvn -B -DskipTests package

FROM eclipse-temurin:21-jre

ARG APP_VERSION
ARG GIT_COMMIT
ARG BUILD_CREATED

LABEL org.opencontainers.image.title="case-service"
LABEL org.opencontainers.image.description="Regulatory case management service"
LABEL org.opencontainers.image.version="${APP_VERSION}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
LABEL org.opencontainers.image.created="${BUILD_CREATED}"
LABEL org.opencontainers.image.vendor="Acme Regulatory Platform"

RUN groupadd --system app && useradd --system --gid app app

WORKDIR /app
COPY --from=build /src/target/*.jar /app/app.jar

USER app

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Catatan:

- label membantu traceability;
- non-root user membantu security baseline;
- final image tidak membawa Maven;
- cache mount mempercepat build tanpa masuk layer final;
- masih perlu digest capture setelah push.

---

## 42. Example: Release Metadata

```yaml
release:
  service: case-service
  version: 1.14.7
  source:
    repository: https://git.example.com/regulatory/case-service
    commit: 9f1a2bc4d5e6
    branch: main
  image:
    repository: registry.example.com/regulatory/case-service
    tags:
      - 1.14.7
      - sha-9f1a2bc4d5e6
      - build-1842
    digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    platform: linux/amd64
  build:
    ci_system: gitlab-ci
    pipeline_id: 1842
    created_at: 2026-06-21T10:15:00Z
    sbom: attached
    provenance: attached
  security:
    scan_status: approved
    critical_open: 0
    high_open_with_fix: 0
    exceptions:
      - cve: CVE-20XX-YYYY
        reason: not reachable in runtime path
        owner: security-team
        expires_at: 2026-07-21
  promotion:
    dev: approved
    staging: approved
    prod: pending
```

Ini membuat deployment defensible.

---

## 43. Runtime Inventory: Mengetahui Apa yang Sedang Berjalan

Supply chain tidak berhenti saat image dipush.

Pertanyaan production:

```text
Image digest apa yang sedang berjalan di host/cluster/service X?
```

Untuk plain Docker:

```bash
docker inspect <container> --format '{{.Image}}'
```

Atau:

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.ID}}'
```

Namun `.Image` bisa menampilkan tag yang dipakai saat run, bukan necessarily resolved digest.

Cek image ID:

```bash
docker inspect <container> --format '{{.Image}}'
docker image inspect <image-id>
```

Untuk orchestrator, deployment spec dan runtime status harus menyimpan digest.

Inventory minimal:

```text
environment
host/cluster
service
container id
image reference
resolved digest
started at
config version
release id
```

Tanpa runtime inventory, SBOM dan scanning sulit dikaitkan ke impact nyata.

---

## 44. Incident Response dengan Image Digest

Misal vulnerability baru diumumkan.

Workflow matang:

```text
1. Identify vulnerable package and versions
2. Query SBOM database
3. Find affected image digests
4. Map digests to running services/environments
5. Prioritize by exposure and exploitability
6. Check if fixed base/dependency exists
7. Rebuild affected images
8. Scan new digest
9. Promote same digest through environments
10. Verify runtime inventory updated
11. Close exception/findings
```

Tanpa digest/SBOM:

```text
1. Search repo manually
2. Guess which images affected
3. Rebuild randomly
4. Hope production updated
```

Yang kedua tidak cukup untuk sistem regulatory atau compliance-sensitive.

---

## 45. Common Anti-Patterns

### 45.1 Deploy by `latest`

```bash
docker run registry.example.com/acme/case-service:latest
```

Masalah:

- tidak reproducible;
- rollback ambigu;
- audit buruk;
- tag bisa berubah diam-diam.

### 45.2 Rebuild per Environment

```text
build-dev
build-staging
build-prod
```

Masalah:

- artifact berbeda;
- bug environment-specific;
- audit sulit.

### 45.3 Secret dalam Image

```Dockerfile
COPY prod-secret.yml /app/application.yml
```

Masalah:

- secret masuk layer;
- registry menjadi secret store;
- semua yang bisa pull image bisa membaca secret.

### 45.4 Scanner sebagai Formality

```text
Scan jalan, tapi hasil tidak dibaca.
```

Masalah:

- false sense of security;
- critical risk bisa lewat.

### 45.5 Scanner sebagai Absolute Gate Tanpa Context

```text
Any high CVE fails forever.
```

Masalah:

- delivery macet;
- exception liar;
- developer menghindari scanner.

### 45.6 Tidak Menyimpan Digest

```text
Release 1.14.7 deployed.
```

Masalah:

- tidak tahu artifact tepatnya;
- tag bisa berubah;
- forensic lemah.

### 45.7 Public Image Langsung di Production

```bash
docker run redis:latest
```

Masalah:

- no approval;
- mutable tag;
- public registry dependency;
- surprise update.

---

## 46. Senior-Level Decision Matrix

### 46.1 Tag vs Digest

| Context | Tag OK? | Digest Needed? |
|---|---:|---:|
| Local dev quick test | Yes | No |
| CI intermediate image | Yes | Preferable |
| Staging deployment | Prefer digest | Yes |
| Production deployment | No as sole identity | Yes |
| Audit record | No | Yes |
| Rollback | No | Yes |

### 46.2 Scanner Policy

| Situation | Action |
|---|---|
| Critical CVE with fix in runtime package | Fail and patch |
| High CVE no fix available | Exception with expiry and mitigation |
| CVE in build stage only | Fix Dockerfile if leaked; otherwise track build risk |
| CVE in unused package | Remove package or document reachability |
| False positive | Document scanner evidence |
| License violation | Legal/compliance process |
| Missing SBOM/provenance | Fail release pipeline |

### 46.3 Base Image Strategy

| Need | Strategy |
|---|---|
| Maximum reproducibility | Pin digest |
| Security patch automation | Scheduled rebuilds |
| Enterprise CA/policy | Internal base image |
| Small attack surface | Slim/distroless/hardened |
| Easier debugging | Slim with tools or separate debug image |
| Multi-platform | Buildx + per-platform scan |

---

## 47. Java-Specific Supply Chain Checklist

Untuk setiap Java service image:

```text
[ ] Final image tidak berisi Maven/Gradle kecuali memang runtime tool.
[ ] Final image tidak berisi source code.
[ ] Final image tidak berisi .m2 atau Gradle cache.
[ ] Final image tidak berisi test fixture.
[ ] Base image version jelas.
[ ] Base image update cadence jelas.
[ ] Image punya semver tag.
[ ] Image punya git SHA tag.
[ ] Digest dicatat di release record.
[ ] Production deploy by digest.
[ ] SBOM generated.
[ ] Provenance generated.
[ ] Scanner result linked to digest.
[ ] Exceptions punya expiry.
[ ] Secret tidak ada di ARG/ENV/layer/history.
[ ] Build menggunakan BuildKit secret mount bila perlu private repo.
[ ] OCI labels ditambahkan.
[ ] Image berjalan non-root.
[ ] Runtime image minimal.
[ ] Multi-stage build digunakan.
[ ] Config environment-specific diinjeksi saat runtime.
[ ] Registry permission least privilege.
[ ] Release tag immutable.
```

---

## 48. Practical Exercise

### Exercise 1 — Inspect Image Identity

Pull image:

```bash
docker pull eclipse-temurin:21-jre
```

Inspect:

```bash
docker image inspect eclipse-temurin:21-jre
```

Cari:

- RepoTags;
- RepoDigests;
- Architecture;
- Os;
- Layers;
- Config labels.

Pertanyaan:

```text
Apakah tag ini cukup untuk audit?
Digest mana yang lebih cocok untuk release record?
```

---

### Exercise 2 — Compare Tag and Digest

```bash
docker pull eclipse-temurin:21-jre
docker image inspect eclipse-temurin:21-jre --format '{{json .RepoDigests}}'
```

Ambil digest lalu pull:

```bash
docker pull eclipse-temurin@sha256:<digest>
```

Pertanyaan:

```text
Apa perbedaan mental model antara pull tag dan pull digest?
```

---

### Exercise 3 — Generate SBOM

```bash
docker scout sbom eclipse-temurin:21-jre
```

Atau untuk image service sendiri:

```bash
docker scout sbom registry.example.com/acme/case-service:1.14.7
```

Pertanyaan:

```text
Package OS apa saja yang muncul?
Dependency Java apa saja yang muncul?
Apakah ada komponen yang tidak kamu kira ada?
```

---

### Exercise 4 — Build dengan SBOM dan Provenance

```bash
docker buildx build \
  --sbom=true \
  --provenance=true \
  -t registry.example.com/acme/case-service:test \
  --push .
```

Pertanyaan:

```text
Apakah registry kamu menyimpan attestation?
Apakah scanner bisa membaca SBOM?
Apakah pipeline mencatat digest?
```

---

### Exercise 5 — Simulasi Release Record

Buat file:

```yaml
service: case-service
version: 0.1.0
git_commit: <commit>
image:
  tag: registry.example.com/acme/case-service:0.1.0
  digest: sha256:<digest>
security:
  sbom: generated
  scan: pending
promotion:
  dev: deployed
  staging: pending
  prod: pending
```

Pertanyaan:

```text
Informasi apa yang masih kurang untuk audit production?
```

---

## 49. Production Heuristics

Gunakan heuristik berikut:

### Heuristic 1

> Kalau kamu tidak bisa menyebut digest, kamu belum tahu artifact yang kamu deploy.

### Heuristic 2

> Tag bagus untuk manusia. Digest bagus untuk mesin, audit, dan rollback.

### Heuristic 3

> Rebuild per environment adalah sumber drift.

### Heuristic 4

> SBOM menjawab “apa isi image”, bukan “apakah image aman”.

### Heuristic 5

> Scanner finding adalah input risk analysis, bukan keputusan otomatis tanpa konteks.

### Heuristic 6

> Signed image bisa tetap vulnerable. Signature membuktikan asal, bukan kualitas.

### Heuristic 7

> Base image adalah dependency production.

### Heuristic 8

> Secret yang pernah masuk layer harus dianggap bocor.

### Heuristic 9

> Promotion yang benar memindahkan digest yang sama, bukan membangun ulang.

### Heuristic 10

> Registry adalah bagian dari production control plane.

---

## 50. Ringkasan

Di Part 018, kita membangun pemahaman bahwa Docker image adalah artifact supply chain.

Poin utama:

- Tag adalah pointer mutable; digest adalah identity immutable.
- Production deployment sebaiknya berbasis digest.
- Build once, promote the same digest.
- Environment-specific config harus diinjeksi saat runtime, bukan dibake ke image.
- Registry adalah artifact distribution system dan harus punya access control.
- Base image adalah dependency production.
- SBOM memberi inventory komponen dalam image.
- Scanner mencocokkan inventory dengan vulnerability database, tetapi hasilnya perlu risk interpretation.
- Signing/provenance/attestation memberi bukti asal-usul dan integritas build.
- Secret tidak boleh masuk image layer/history.
- Java image supply chain mencakup Maven/Gradle dependencies, JVM, OS packages, base image, dan registry policy.
- Release record harus menyimpan tag, digest, source commit, SBOM, provenance, scanner status, dan promotion state.

---

## 51. Checklist Pemahaman

Kamu siap lanjut jika bisa menjelaskan:

```text
[ ] Kenapa tag tidak cukup untuk audit production.
[ ] Perbedaan tag, digest, manifest, dan manifest list.
[ ] Kenapa build once promote same digest lebih aman daripada rebuild per environment.
[ ] Apa isi SBOM dan kenapa penting.
[ ] Apa keterbatasan vulnerability scanner.
[ ] Kenapa severity CVE tidak sama dengan business risk.
[ ] Apa bedanya signing dan scanning.
[ ] Apa itu provenance.
[ ] Bagaimana secret bisa bocor lewat Docker build.
[ ] Apa strategi tag yang sehat untuk Java service.
[ ] Bagaimana release record berbasis digest dibuat.
[ ] Kenapa base image harus diperlakukan sebagai dependency production.
```

---

## 52. Referensi Utama

- Docker Docs — Image digests: https://docs.docker.com/dhi/core-concepts/digests/
- Docker Docs — Docker Scout: https://docs.docker.com/scout/
- Docker Docs — Docker Scout SBOM CLI: https://docs.docker.com/reference/cli/docker/scout/sbom/
- Docker Docs — SBOM attestations: https://docs.docker.com/build/metadata/attestations/sbom/
- Docker Docs — GitHub Actions SBOM and provenance attestations: https://docs.docker.com/build/ci/github-actions/attestations/
- Docker Docs — Image provenance: https://docs.docker.com/dhi/core-concepts/provenance/
- Docker Docs — Content trust in Docker: https://docs.docker.com/engine/security/trust/
- Docker Docs — docker image pull: https://docs.docker.com/reference/cli/docker/image/pull/
- OCI Image Spec: https://github.com/opencontainers/image-spec
- SLSA Framework: https://slsa.dev/
- Sigstore Cosign: https://docs.sigstore.dev/cosign/overview/

---

## 53. Status Seri

Selesai:

```text
Part 000 — Orientation: Docker as Process Packaging, Not Mini VM
Part 001 — Container Mental Model: Process, Namespace, Cgroup, Filesystem Boundary
Part 002 — Docker Architecture: Client, Daemon, Engine, containerd, runc
Part 003 — Image Mental Model: Layer, Digest, Tag, Manifest, Platform
Part 004 — Container Lifecycle: Create, Start, Stop, Restart, Remove
Part 005 — Docker CLI Fluency: From Command User to Runtime Inspector
Part 006 — Dockerfile Foundations: Instruction Semantics, Not Recipes
Part 007 — Docker Build Internals: Build Context, Cache, Layer Reuse, BuildKit
Part 008 — Multi-Stage Build for Java: Maven, Gradle, JAR, Layers
Part 009 — Java Runtime in Containers: Memory, CPU, GC, Signals
Part 010 — ENTRYPOINT and CMD: Process Contract, Override Semantics, PID 1
Part 011 — Filesystem and Volumes: Immutable Image, Mutable Runtime State
Part 012 — Docker Networking: Bridge, Host, None, DNS, Port Publishing
Part 013 — Docker Compose as Local System Model
Part 014 — Compose for Java Development: Databases, Brokers, Mock Services
Part 015 — Container Health: Healthcheck, Readiness, Liveness, Startup Semantics
Part 016 — Configuration and Secrets: Env, Files, Build Args, Runtime Injection
Part 017 — Docker Security Fundamentals: Root, Capabilities, Seccomp, AppArmor
Part 018 — Image Supply Chain: Registry, Tags, Digests, SBOM, Signing, Scanning
```

Berikutnya:

```text
Part 019 — Base Image Strategy for Java: JDK, JRE, Alpine, Distroless, Slim
```

Seri belum selesai.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — Docker Security Fundamentals: Root, Capabilities, Seccomp, AppArmor</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-019.md">Part 019 — Base Image Strategy for Java: JDK, JRE, Alpine, Distroless, Slim ➡️</a>
</div>
