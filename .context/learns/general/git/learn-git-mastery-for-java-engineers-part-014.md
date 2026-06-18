# learn-git-mastery-for-java-engineers-part-014.md

# Part 014 — Git Workflow untuk Tim: Trunk-Based, Git Flow, GitHub Flow

> Seri: `git-mastery-for-java-engineers`  
> Bagian: `014 / 032`  
> Status seri: **belum selesai**  
> Bagian terakhir: `learn-git-mastery-for-java-engineers-part-032.md`

---

## 0. Tujuan Bagian Ini

Sampai bagian sebelumnya, kita sudah membangun fondasi teknis Git:

- commit graph,
- branch sebagai pointer,
- `HEAD`,
- working tree,
- index,
- merge,
- rebase,
- conflict,
- remote,
- pull request / merge request.

Sekarang kita naik satu level: **bagaimana tim menggunakan semua primitive itu sebagai workflow engineering**.

Pertanyaan utama bagian ini bukan:

```text
Workflow Git mana yang paling bagus?
```

Pertanyaan yang lebih benar:

```text
Delivery model tim kita seperti apa?
Risiko production kita seperti apa?
Seberapa sering kita release?
Seberapa kuat CI/CD kita?
Seberapa besar kebutuhan audit dan compliance?
Berapa lama perubahan boleh hidup sebelum terintegrasi?
```

Git workflow yang baik bukan workflow yang populer. Git workflow yang baik adalah workflow yang:

1. membuat integrasi sering dan aman,
2. menjaga branch utama tetap sehat,
3. menurunkan risiko conflict dan regression,
4. cocok dengan release cadence,
5. mendukung observability dan audit trail,
6. dapat dijalankan manusia secara konsisten,
7. tidak menciptakan birokrasi yang tidak perlu.

---

## 1. Mental Model: Git Workflow adalah Operating Model, Bukan Sekadar Branch Naming

Banyak tim mengira Git workflow hanyalah aturan nama branch:

```text
feature/xxx
bugfix/xxx
release/xxx
hotfix/xxx
```

Itu hanya lapisan paling luar.

Secara lebih dalam, Git workflow mengatur beberapa hal:

| Dimensi | Pertanyaan |
|---|---|
| Integration model | Kapan perubahan masuk ke branch utama? |
| Release model | Dari branch mana artifact production dibuat? |
| Review model | Kapan dan bagaimana review terjadi? |
| CI model | Branch mana yang wajib selalu hijau? |
| Risk model | Di mana perubahan berisiko ditahan? |
| Recovery model | Bagaimana rollback/hotfix dilakukan? |
| Audit model | Bukti apa yang tersimpan di Git/PR/CI? |
| Ownership model | Siapa boleh merge apa? |
| Parallelism model | Bagaimana beberapa versi dirawat bersamaan? |

Jadi workflow Git sebenarnya adalah kombinasi dari:

```text
branch strategy
+ merge strategy
+ release strategy
+ review policy
+ CI/CD policy
+ versioning policy
+ governance policy
```

Tanpa keselarasan antar bagian tersebut, workflow akan terlihat rapi di diagram tetapi buruk di realita.

---

## 2. Invariant yang Harus Dijaga oleh Workflow Apa Pun

Sebelum membandingkan trunk-based, Git Flow, GitHub Flow, dan GitLab Flow, kita tetapkan invariant umum.

### 2.1 Branch Utama Harus Punya Makna yang Jelas

Contoh branch utama:

```text
main
master
develop
release/1.8
production
```

Masalah muncul ketika makna branch tidak jelas.

Contoh buruk:

```text
main      = kadang latest dev, kadang production
develop   = kadang stable, kadang tempat eksperimen
staging   = kadang environment state, kadang release candidate
production= kadang source, kadang deployment marker
```

Aturan sehat:

```text
Setiap branch jangka panjang harus memiliki semantik tunggal.
```

Contoh:

```text
main = current integration branch yang harus selalu buildable
release/2.4 = stabilization branch untuk minor version 2.4
hotfix/INC-1234 = temporary branch untuk patch production incident
```

### 2.2 Branch Panjang Meningkatkan Risiko Integrasi

Semakin lama branch hidup, semakin besar kemungkinan:

- base branch bergerak jauh,
- dependency berubah,
- file yang sama disentuh tim lain,
- test expectation berubah,
- API contract berubah,
- migration berubah,
- semantic conflict muncul,
- PR menjadi besar dan sulit direview.

Secara praktis:

```text
branch lifetime ↑ => integration risk ↑
```

Bukan berarti semua long-lived branch salah. Release branch bisa long-lived karena memang dipakai untuk maintenance versi. Yang berbahaya adalah **feature branch long-lived** yang menyimpan perubahan besar terlalu lama.

### 2.3 Integrasi Harus Lebih Sering daripada Release

Kesalahan umum:

```text
Karena release bulanan, maka merge juga boleh bulanan.
```

Ini keliru.

Release cadence dan integration cadence adalah dua hal berbeda.

```text
Integration = kapan perubahan digabung agar konflik dan regression ditemukan.
Release     = kapan perubahan tersedia bagi user/production.
```

Tim kuat biasanya berusaha:

```text
integrate frequently, release deliberately
```

Artinya perubahan sering masuk ke branch integrasi, tetapi exposure ke user dapat dikendalikan dengan:

- feature flag,
- configuration toggle,
- staged rollout,
- dark launch,
- environment promotion,
- release branch,
- deployment approval.

### 2.4 CI Harus Menjadi Penjaga Branch Utama

Workflow Git tanpa CI kuat sering berubah menjadi ritual manual.

Minimal branch utama harus dijaga oleh:

- compile/build,
- unit test,
- integration test penting,
- static analysis,
- dependency vulnerability scanning,
- formatting/linting bila relevan,
- migration validation,
- contract test untuk API penting.

Untuk Java backend:

```text
mvn test
mvn verify
./gradlew test
./gradlew check
```

bukan formalitas, melainkan filter utama agar branch integrasi tetap sehat.

### 2.5 History Harus Mendukung Forensic Debugging

Workflow yang baik harus membantu menjawab:

```text
Commit mana yang masuk ke release ini?
PR mana yang membawa perubahan itu?
Build mana yang dibuat dari commit tersebut?
Siapa yang approve?
Test apa yang lewat?
Jika ada incident, commit mana yang harus direvert?
```

Untuk sistem regulatory, financial, case management, enforcement lifecycle, dan sistem enterprise yang harus defensible, ini bukan nice-to-have.

Ini bagian dari operational evidence.

---

## 3. Workflow 1: Trunk-Based Development

### 3.1 Definisi

**Trunk-Based Development** adalah strategi di mana developer mengintegrasikan perubahan ke satu branch utama, biasanya `main` atau `trunk`, secara sering. Feature branch boleh ada, tetapi harus **short-lived**.

Model sederhananya:

```text
main:  A---B---C---D---E---F
             \     \
feature/x     x1    merged quickly
```

Branch utama adalah pusat integrasi.

Tujuan utamanya:

```text
reduce integration delay
```

Semakin cepat perubahan bertemu dengan perubahan tim lain, semakin cepat conflict/regression ditemukan.

### 3.2 Bentuk Trunk-Based

Ada dua gaya umum.

#### Gaya A — Direct to Trunk

Developer commit langsung ke `main`.

```text
main: A---B---C---D
```

Biasanya hanya cocok jika:

- tim kecil,
- CI sangat cepat,
- pairing/mob programming kuat,
- test suite terpercaya,
- code ownership jelas,
- branch protection tetap ada atau commit rights terbatas.

Untuk banyak tim enterprise, gaya ini terlalu terbuka.

#### Gaya B — Short-Lived Feature Branch

Developer membuat branch singkat, lalu merge cepat ke `main`.

```text
main:      A---B---C---D
              \     \
feature/a      a1----M
```

Ini lebih umum di tim modern:

- branch hidup jam/hari, bukan minggu,
- PR kecil,
- CI jalan di PR,
- merge cepat setelah review,
- fitur besar disembunyikan dengan feature flag.

### 3.3 Kenapa Trunk-Based Kuat

Trunk-based memaksa tim mengurangi batch size.

Batch size kecil berarti:

- PR lebih mudah direview,
- conflict lebih kecil,
- rollback lebih mudah,
- regression lebih mudah dilacak,
- feedback lebih cepat,
- knowledge sharing lebih baik,
- branch tidak membusuk.

Untuk Java engineer, ini sangat terasa pada:

- refactor service layer,
- upgrade dependency,
- perubahan DTO/API,
- migration schema,
- perubahan Spring configuration,
- perubahan shared library,
- contract antar microservice.

Jika semua ditahan di branch selama dua minggu, integrasi akan menjadi event besar dan berisiko.

### 3.4 Syarat Trunk-Based yang Sering Diabaikan

Trunk-based bukan hanya “merge ke main cepat”. Ia membutuhkan disiplin engineering.

Syarat penting:

1. CI cepat dan reliable.
2. Test suite cukup kuat.
3. PR kecil.
4. Feature flag untuk perubahan besar.
5. Branch protection.
6. Code review cepat.
7. Build reproducible.
8. Rollback/roll-forward jelas.
9. Observability cukup baik.
10. Tim mampu memecah pekerjaan besar menjadi increment kecil.

Tanpa syarat ini, trunk-based bisa berubah menjadi:

```text
main sering rusak
CI merah terus
review asal-asalan
feature setengah jadi bocor
rollback kacau
```

### 3.5 Branch by Abstraction

Untuk perubahan besar yang tidak bisa selesai dalam satu PR kecil, trunk-based sering menggunakan teknik **branch by abstraction**.

Alih-alih membuat branch besar yang hidup lama, kita membuat abstraction layer agar implementasi baru bisa masuk bertahap.

Contoh Java:

Kondisi awal:

```java
public class PaymentService {
    public PaymentResult pay(PaymentRequest request) {
        // legacy implementation
    }
}
```

Ingin migrasi ke payment engine baru.

Jangan langsung membuat branch besar selama tiga minggu.

Buat interface:

```java
public interface PaymentProcessor {
    PaymentResult pay(PaymentRequest request);
}
```

Implementasi lama:

```java
public class LegacyPaymentProcessor implements PaymentProcessor {
    public PaymentResult pay(PaymentRequest request) {
        // existing behavior
    }
}
```

Lalu integrasikan tanpa mengubah behavior:

```java
public class PaymentService {
    private final PaymentProcessor processor;

    public PaymentService(PaymentProcessor processor) {
        this.processor = processor;
    }

    public PaymentResult pay(PaymentRequest request) {
        return processor.pay(request);
    }
}
```

Setelah itu implementasi baru bisa ditambahkan bertahap:

```java
public class NewPaymentProcessor implements PaymentProcessor {
    public PaymentResult pay(PaymentRequest request) {
        // new behavior behind feature flag
    }
}
```

Dengan feature flag:

```java
@Bean
PaymentProcessor paymentProcessor(FeatureFlags flags) {
    if (flags.isEnabled("new-payment-engine")) {
        return new NewPaymentProcessor();
    }
    return new LegacyPaymentProcessor();
}
```

Git workflow-nya tetap short-lived, tetapi perubahan sistem bisa besar.

Mental model:

```text
Jangan sembunyikan kompleksitas di branch lama.
Sembunyikan kompleksitas di desain kode yang bisa diintegrasikan bertahap.
```

### 3.6 Kapan Trunk-Based Cocok

Trunk-based cocok jika:

- tim ingin delivery cepat,
- release sering,
- CI/CD matang,
- test suite cukup baik,
- fitur bisa dipecah kecil,
- feature flag tersedia,
- team review cepat,
- produk web/SaaS/internal service,
- microservices dengan deployment mandiri.

### 3.7 Kapan Trunk-Based Sulit

Trunk-based sulit jika:

- test lambat dan flaky,
- release harus batch besar,
- tidak ada feature flag,
- approval compliance sangat berat,
- perubahan harus dikunci lama sebelum release,
- ada banyak versi on-premise yang dirawat,
- tim belum mampu slicing pekerjaan,
- dependency antar tim terlalu ketat.

Dalam kondisi ini, trunk-based masih mungkin, tetapi butuh investasi engineering.

---

## 4. Workflow 2: GitHub Flow

### 4.1 Definisi

**GitHub Flow** adalah workflow sederhana:

1. `main` selalu merepresentasikan state yang siap deploy.
2. Buat branch dari `main`.
3. Commit perubahan di branch.
4. Buka pull request.
5. Diskusi/review/CI.
6. Merge ke `main`.
7. Deploy.

Diagram:

```text
main:      A---B---C-----------M---D
                \             /
feature/x        x1---x2---x3
```

GitHub Flow mirip trunk-based dengan short-lived branch, tetapi lebih menekankan PR sebagai control point.

### 4.2 Makna `main` dalam GitHub Flow

Dalam GitHub Flow, `main` idealnya:

```text
always deployable
```

Bukan hanya “buildable”.

Artinya:

- semua test penting lewat,
- tidak ada feature setengah jadi yang aktif untuk user,
- migration aman,
- dependency tidak rusak,
- config default aman,
- deployment pipeline bisa mengambil commit dari `main`.

Untuk Java backend:

```text
main commit -> CI -> artifact -> deploy candidate
```

### 4.3 Keunggulan GitHub Flow

GitHub Flow kuat karena sederhana.

Kelebihan:

- mudah dipahami,
- cocok untuk continuous delivery,
- PR menjadi pusat review,
- branch pendek,
- history tidak terlalu kompleks,
- mudah diotomasi dengan CI/CD,
- cocok untuk web service modern.

### 4.4 Risiko GitHub Flow

Risiko utama muncul jika tim menyamakan `merge to main` dengan `release to production` tanpa kontrol.

Jika setiap merge langsung deploy production, maka syaratnya berat:

- CI harus kuat,
- observability harus baik,
- rollback harus cepat,
- feature flag harus disiplin,
- review harus berkualitas,
- deployment harus otomatis dan repeatable.

Jika tim belum siap, GitHub Flow bisa dimodifikasi:

```text
merge to main -> deploy to staging -> approval -> deploy production
```

Tetapi hati-hati: jangan mengubahnya menjadi environment branch kacau.

### 4.5 GitHub Flow untuk Java Microservices

Untuk microservice Java, GitHub Flow biasanya cocok jika setiap service punya repo/pipeline sendiri.

Contoh:

```text
customer-service/main
case-service/main
enforcement-service/main
notification-service/main
```

Setiap service:

- branch dari `main`,
- PR kecil,
- CI service-specific,
- deploy independent,
- contract test untuk dependency,
- release dengan tag atau build metadata.

Risiko:

- perubahan lintas service butuh koordinasi,
- backward compatibility API wajib dijaga,
- database migration harus expand/contract,
- shared library versioning harus disiplin.

---

## 5. Workflow 3: Git Flow

### 5.1 Definisi

**Git Flow** adalah workflow branching yang lebih formal. Ia memakai beberapa branch dengan peran berbeda:

```text
main/master  = release history / production releases
develop      = integration branch untuk next release
feature/*    = work branch dari develop
release/*    = stabilization branch sebelum release
hotfix/*     = patch branch dari main/master
```

Diagram konseptual:

```text
main:      A---------R1-------------------R2
            \       /                     /
develop:     B---C--D---E---F------------G
              \    \       \            /
feature/a      a1---M       \          /
feature/b                b1--M        /
release/1.1                   r1--r2--M
hotfix/1.0.1        h1--M
```

Git Flow lahir dari kebutuhan release yang lebih terstruktur, terutama ketika release tidak continuous dan beberapa fase stabilization dibutuhkan.

### 5.2 Peran Branch dalam Git Flow

#### `main` / `master`

Makna:

```text
production release history
```

Biasanya hanya berisi commit release dan hotfix.

Setiap release diberi tag:

```bash
git tag -a v1.4.0 -m "Release 1.4.0"
```

#### `develop`

Makna:

```text
integration branch untuk release berikutnya
```

Feature branch dibuat dari `develop` dan digabung kembali ke `develop`.

#### `feature/*`

Makna:

```text
temporary branch untuk fitur tertentu
```

Contoh:

```text
feature/case-escalation-rule
feature/payment-retry-policy
feature/audit-log-export
```

#### `release/*`

Makna:

```text
stabilization branch untuk kandidat release
```

Contoh:

```text
release/2.3.0
```

Di branch ini biasanya hanya boleh:

- bug fix,
- version bump,
- release notes,
- configuration finalization,
- minor stabilization.

Bukan fitur besar baru.

#### `hotfix/*`

Makna:

```text
urgent fix untuk production release
```

Hotfix dibuat dari `main`, bukan dari `develop`, karena bug terjadi pada production state.

Setelah selesai, hotfix harus masuk ke:

- `main`,
- `develop`,
- release branch aktif bila ada.

### 5.3 Keunggulan Git Flow

Git Flow cocok untuk:

- release terjadwal,
- produk desktop/mobile/on-premise,
- sistem yang tidak deploy setiap hari,
- beberapa versi yang harus dirawat,
- fase QA/stabilization eksplisit,
- release approval formal,
- enterprise/regulatory environment tertentu.

Kelebihan:

- branch role jelas,
- release stabilization terpisah,
- hotfix path eksplisit,
- production history bersih,
- cocok untuk versioned product,
- mendukung maintenance release.

### 5.4 Kelemahan Git Flow

Git Flow juga punya biaya besar.

Risiko:

- `develop` menjadi dumping ground,
- feature branch hidup terlalu lama,
- merge antar branch menjadi rumit,
- bugfix harus diport ke beberapa branch,
- conflict lebih sering,
- feedback lambat,
- release besar dan menegangkan,
- CI/CD menjadi lebih kompleks,
- developer bingung branch mana source of truth.

Untuk banyak web/SaaS backend modern, Git Flow sering terlalu berat.

### 5.5 Git Flow untuk Java Enterprise

Git Flow dapat masuk akal untuk Java enterprise jika:

- release bulanan/kuartalan,
- ada UAT formal,
- ada change advisory board,
- production deployment window terbatas,
- beberapa client memakai versi berbeda,
- on-premise installation,
- maintenance branch wajib,
- audit trail release harus jelas.

Contoh:

```text
main          = released production versions
develop       = next release integration
release/4.8   = UAT/stabilization for 4.8
hotfix/4.7.3  = production patch for 4.7 line
```

Namun tetap perlu menjaga branch lifetime dan backport discipline.

---

## 6. Workflow 4: GitLab Flow

### 6.1 Definisi

GitLab Flow berusaha berada di tengah antara GitHub Flow yang sederhana dan Git Flow yang lebih kompleks.

Ide utamanya:

- feature branch dari `main`,
- merge request untuk review,
- `main` sebagai pusat integrasi,
- environment/release handling bisa ditambahkan sesuai kebutuhan.

GitLab documentation juga menekankan bahwa strategi sederhana—feature branch lalu merge langsung ke `main`—cukup untuk banyak tim; branch strategy yang lebih kompleks dipertimbangkan jika ada kebutuhan seperti testing/compliance.

### 6.2 Bentuk GitLab Flow dengan Environment Branch

Salah satu variasi GitLab Flow menggunakan environment branch:

```text
main -> pre-production -> production
```

Diagram:

```text
main:           A---B---C---D
                         \
pre-production:           C---D
                              \
production:                    D
```

Makna:

- `main` menerima perubahan,
- `pre-production` merepresentasikan state yang dipromosikan ke pre-prod,
- `production` merepresentasikan state yang dipromosikan ke prod.

Ini terlihat menarik, tetapi harus sangat hati-hati.

### 6.3 Environment Branch: Berguna atau Anti-Pattern?

Environment branch bisa berguna jika branch benar-benar merepresentasikan **promotion state**.

Tetapi sering menjadi anti-pattern ketika developer mulai commit langsung ke branch environment:

```text
main
staging
production
```

Lalu muncul kondisi buruk:

```text
commit A hanya di staging
commit B hanya di production
commit C di main tapi belum di staging
hotfix D langsung di production dan lupa balik ke main
```

Akibatnya:

- source of truth kabur,
- environment drift,
- rollback sulit,
- audit sulit,
- merge arah balik membingungkan,
- production branch bukan lagi hasil promosi yang bersih.

Aturan sehat:

```text
Environment branch tidak boleh menjadi tempat development.
Environment branch hanya boleh menerima promosi dari branch upstream yang jelas.
```

Dalam banyak tim modern, environment branch bisa diganti dengan:

- deployment records,
- tags,
- release objects,
- artifact promotion,
- environment metadata di deployment system,
- GitOps repo terpisah untuk deployment config.

### 6.4 GitLab Flow dengan Release Branch

Untuk produk yang perlu maintenance versi, GitLab Flow dapat memakai release branch:

```text
main
release/2.3
release/2.4
release/3.0
```

Bugfix penting dari `main` dapat di-backport ke release branch tertentu.

Ini cocok untuk:

- public API versioning,
- library/framework,
- on-premise product,
- client yang memakai versi berbeda,
- regulated release line.

---

## 7. Perbandingan Workflow

| Workflow | Branch utama | Branch tambahan | Cocok untuk | Risiko utama |
|---|---|---|---|---|
| Trunk-Based | `main`/`trunk` | short-lived branch | delivery cepat, CI kuat | main rusak jika discipline lemah |
| GitHub Flow | `main` | feature branch + PR | web/SaaS, microservice | deployability palsu jika CI lemah |
| Git Flow | `main` + `develop` | feature/release/hotfix | release terjadwal, produk versi | kompleks, merge/backport berat |
| GitLab Flow | `main` | environment/release branch opsional | tim butuh fleksibilitas | environment branch drift |

---

## 8. Decision Matrix: Memilih Workflow

### 8.1 Jika Tim Release Harian atau Mingguan

Rekomendasi:

```text
GitHub Flow atau Trunk-Based dengan short-lived feature branch
```

Syarat:

- CI cepat,
- review cepat,
- feature flag,
- rollback/roll-forward,
- deployment automation,
- branch protection.

### 8.2 Jika Tim Release Bulanan dengan UAT Formal

Rekomendasi:

```text
Trunk/main integration + release branch untuk stabilization
```

Tidak harus Git Flow penuh.

Model:

```text
main = integration branch
release/2.5 = stabilization branch
hotfix/* = temporary patch branch
```

Fitur tetap masuk `main` sering. Ketika cutoff release terjadi, buat `release/x.y`.

### 8.3 Jika Produk On-Premise dengan Banyak Versi Aktif

Rekomendasi:

```text
Git Flow atau GitLab Flow dengan release branches
```

Karena maintenance branch memang dibutuhkan.

Contoh:

```text
main
release/3.7
release/3.8
release/4.0
```

Wajib punya:

- backport policy,
- support window,
- tagging discipline,
- changelog per release line,
- automated patch build.

### 8.4 Jika Tim Kecil dengan Service Internal

Rekomendasi:

```text
GitHub Flow sederhana
```

Aturan:

- branch kecil,
- PR cepat,
- merge ke `main`,
- deploy dari `main`,
- tag bila perlu.

Jangan memakai Git Flow penuh jika tidak ada kebutuhan nyata.

### 8.5 Jika Sistem Sangat Regulated

Rekomendasi tidak otomatis Git Flow.

Yang dibutuhkan adalah:

- traceability,
- approval evidence,
- reproducible build,
- release tagging,
- separation of duties,
- branch protection,
- audit logs,
- change request linkage,
- deployment evidence,
- rollback plan.

Ini bisa dicapai dengan beberapa model.

Contoh model kuat:

```text
main = integration, protected, always green
release/x.y = controlled release candidate / stabilization
hotfix/INC-n = production patch from release tag
```

PR harus link ke issue/change request. CI artifact harus link ke commit SHA. Release tag harus signed/annotated jika governance membutuhkan.

---

## 9. Merge Strategy dalam Workflow

Workflow branch tidak lengkap tanpa merge strategy.

### 9.1 Merge Commit

```text
feature branch -> merge commit into main
```

Kelebihan:

- preserves branch context,
- jelas kapan integrasi terjadi,
- bagus untuk feature yang multi-commit,
- memudahkan forensic PR-level integration.

Kekurangan:

- history lebih bercabang,
- log bisa ramai.

Cocok untuk:

- Git Flow,
- release branch,
- feature besar,
- tim yang ingin mempertahankan konteks integrasi.

### 9.2 Squash Merge

```text
feature branch commits -> single commit on main
```

Kelebihan:

- history `main` linear dan ringkas,
- PR kecil menjadi satu unit,
- mudah revert satu PR.

Kekurangan:

- commit granular di branch hilang dari main,
- author chronology berkurang,
- branch-local history tidak preserved.

Cocok untuk:

- GitHub Flow,
- PR kecil,
- tim yang ingin main history bersih,
- product/service repository.

### 9.3 Rebase and Merge

```text
feature commits replayed onto main
```

Kelebihan:

- history linear,
- commit granular tetap ada,
- tidak ada merge commit.

Kekurangan:

- bisa membuat commit kecil yang kurang meaningful masuk main,
- perlu commit hygiene tinggi,
- conflict resolution context bisa kurang jelas.

Cocok jika:

- tim disiplin membuat commit atomic,
- PR tidak terlalu besar,
- history linear diutamakan.

### 9.4 Fast-Forward Only

```text
main pointer maju tanpa merge commit
```

Kelebihan:

- history linear,
- simple graph.

Kekurangan:

- perlu rebase sebelum merge,
- branch context hilang,
- tidak selalu cocok untuk PR-based audit.

---

## 10. Environment Branch Anti-Pattern secara Mendalam

### 10.1 Pola yang Tampak Masuk Akal

Banyak tim membuat branch seperti:

```text
dev
sit
uat
staging
production
```

Motivasinya:

```text
Setiap environment punya branch sendiri.
Deploy environment X dari branch X.
```

Ini terlihat sederhana, tetapi sering mencampur dua konsep:

```text
source control state
vs
deployment environment state
```

Git branch adalah pointer ke commit. Environment adalah runtime deployment state.

Menyamakan keduanya sering menciptakan drift.

### 10.2 Drift Scenario

Misal:

```text
main:       A---B---C---D
staging:    A---B---C
production: A---B
```

Lalu ada hotfix langsung ke production:

```text
production: A---B---H
```

Lalu staging menerima feature lain:

```text
staging: A---B---C---E
```

Sekarang:

- production punya `H`, staging tidak,
- staging punya `C/E`, production tidak,
- main mungkin punya `D`, belum tentu ada di mana-mana,
- merge balik membingungkan,
- audit “apa yang ada di production?” tidak sederhana.

### 10.3 Alternatif yang Lebih Sehat

Gunakan satu source branch plus deployment metadata:

```text
main: A---B---C---D---E
             tag:v1.2.0
                     tag:v1.3.0
```

Environment state dicatat sebagai:

```text
dev        -> commit E
staging    -> commit D
production -> tag v1.2.0 / commit C
```

Informasi ini bisa berada di:

- deployment dashboard,
- CI/CD metadata,
- GitOps config repo,
- release record,
- Kubernetes image tag,
- artifact repository.

Bukan harus branch source code.

---

## 11. Workflow untuk Java Backend: Contoh Praktis

### 11.1 Tim Java Service dengan Continuous Delivery

Rekomendasi:

```text
GitHub Flow / trunk-based short-lived branch
```

Policy:

```text
main protected
PR required
CI required
squash merge allowed
feature flags for incomplete features
deploy from main
annotated tags for production releases if needed
```

Branch:

```text
main
feature/CASE-1823-escalation-timeout
bugfix/CASE-1902-null-status-transition
hotfix/INC-2031-fix-deadlock
```

CI:

```bash
./mvnw verify
./gradlew check
```

PR checklist:

- API backward compatible?
- DB migration safe?
- transaction boundary unchanged or reviewed?
- concurrency risk reviewed?
- idempotency considered?
- logs/metrics updated?
- rollback/roll-forward path clear?

### 11.2 Java Monolith dengan Monthly Release

Rekomendasi:

```text
main + release branch
```

Model:

```text
main = ongoing integration
release/2026.07 = stabilization for July release
```

Flow:

```text
feature branch -> PR -> main
cut release/2026.07 from main
bug fixes -> release/2026.07
critical fixes back-merged/cherry-picked to main
release tag v2026.07.0
```

Policy:

- no new large feature after release branch cut,
- only bugfix/stabilization on release branch,
- every release branch fix must be reconciled to main,
- release tag must map to artifact version.

### 11.3 Library/SDK Java dengan Multiple Supported Versions

Rekomendasi:

```text
main + maintenance branches
```

Branch:

```text
main
release/1.x
release/2.x
release/3.x
```

Flow:

- bug fixed in `main`,
- cherry-pick/backport to affected release lines,
- tag per release line:

```text
v1.9.4
v2.7.2
v3.1.0
```

Policy:

- public API compatibility rules,
- semantic versioning,
- deprecation policy,
- changelog per version,
- backport labels in PR.

### 11.4 Regulated Case Management Platform

Rekomendasi umum:

```text
protected main + controlled release branches + hotfix path
```

Model:

```text
main
release/2026-Q3
hotfix/INC-5421-correct-escalation-deadline
```

Governance:

- PR linked to requirement/change request,
- required reviewer by domain/code owner,
- CI evidence retained,
- release tag annotated/signed if required,
- deployment artifact maps to commit SHA,
- hotfix starts from production tag,
- hotfix merged/cherry-picked back to main and active release branches,
- rollback/roll-forward documented.

---

## 12. Long-Lived Feature Branch: Failure Model

### 12.1 Scenario

Tim membuat branch:

```text
feature/new-enforcement-workflow
```

Branch hidup 4 minggu.

Selama itu:

- `main` mengubah `CaseStatus`,
- tim lain mengubah migration schema,
- ada dependency upgrade Spring Boot,
- API response berubah,
- test helper berubah,
- authorization model berubah.

Saat merge:

```text
100 files changed
30 conflicts
CI fails
reviewer overwhelmed
semantic conflict not detected
```

Ini bukan masalah Git. Ini masalah batch size.

### 12.2 Cara Memecah

Pecah menjadi incremental PR:

1. Introduce new enum/state model without behavior change.
2. Add database column nullable.
3. Add service abstraction.
4. Add feature flag.
5. Add new workflow path disabled by default.
6. Add tests for new path.
7. Enable internally.
8. Migrate old cases gradually.
9. Remove old path.

Git branch tetap pendek. Perubahan produk tetap besar.

---

## 13. Hotfix Policy: Workflow Apa Pun Harus Punya Jawaban

Pertanyaan hotfix:

```text
Production sekarang berjalan dari commit/tag mana?
Dari mana branch hotfix dibuat?
Bagaimana patch diuji?
Ke branch mana patch dikembalikan?
Bagaimana release tag baru dibuat?
```

Contoh policy sehat:

```text
1. Identify production tag: v2.8.3.
2. Create hotfix branch from v2.8.3.
3. Implement minimal fix.
4. Run targeted and regression tests.
5. PR review with incident context.
6. Merge/tag v2.8.4.
7. Deploy artifact from v2.8.4.
8. Cherry-pick/merge hotfix into main.
9. Cherry-pick into active release branch if needed.
10. Link commit/PR to incident record.
```

Command sketch:

```bash
git fetch --all --tags
git switch -c hotfix/INC-5421 v2.8.3
# edit fix
git add .
git commit -m "fix: correct escalation deadline calculation"
git push -u origin hotfix/INC-5421
```

After approval/release:

```bash
git tag -a v2.8.4 -m "Hotfix release v2.8.4 for INC-5421"
git push origin v2.8.4
```

Then reconcile:

```bash
git switch main
git pull --ff-only
git cherry-pick <hotfix-commit>
git push
```

---

## 14. Branch Protection as Workflow Enforcement

Workflow yang hanya tertulis di wiki akan dilanggar saat tekanan tinggi.

Gunakan branch protection.

Untuk `main`:

- require pull request,
- require status checks,
- require up-to-date branch if needed,
- require code owner review,
- disallow force push,
- disallow direct push,
- require signed commits/tags if policy needs it,
- restrict who can push to release branches.

Untuk `release/*`:

- require PR,
- restrict changes to release managers / maintainers,
- require release checklist,
- require backport tracking.

Untuk `hotfix/*`:

- allow fast path, but not no-control path,
- require incident link,
- require post-hotfix reconciliation.

---

## 15. Workflow Smells

### 15.1 Branch Menjadi Tempat Menyembunyikan Ketidakpastian

Tanda:

```text
Nanti saja merge kalau sudah selesai semua.
```

Biasanya berarti pekerjaan terlalu besar atau belum ada feature flag/abstraction.

### 15.2 `develop` Selalu Merah

Jika `develop` sering gagal build, ia bukan integration branch. Ia dumping ground.

### 15.3 Release Branch Menjadi Feature Branch Baru

Jika setelah branch `release/2.5` dibuat masih banyak fitur besar masuk, cutoff tidak bermakna.

### 15.4 Hotfix Tidak Dikembalikan ke Main

Ini menciptakan bug resurrection: bug yang sudah diperbaiki di production muncul lagi di release berikutnya.

### 15.5 Environment Branch Diverge

Jika `production`, `staging`, dan `main` punya commit unik yang tidak jelas arah promosinya, audit dan rollback akan sulit.

### 15.6 PR Terlalu Besar

PR 3.000 baris dengan 50 file bukan review. Itu transfer risiko ke reviewer.

### 15.7 Workflow Terlalu Kompleks untuk Masalah Sederhana

Tim kecil dengan satu service internal tidak perlu Git Flow penuh hanya agar terlihat enterprise.

---

## 16. Praktik Rekomendasi untuk Banyak Tim Java Modern

Untuk mayoritas tim Java backend modern, baseline yang sehat:

```text
main protected and always green
short-lived feature branches
pull request required
CI required
small PRs
squash merge or rebase merge depending on commit discipline
release tags for production artifacts
release branches only when stabilization or maintenance is truly needed
hotfix from production tag
feature flags for incomplete/large work
```

Ini menggabungkan kesederhanaan GitHub Flow/trunk-based dengan kontrol release yang cukup.

---

## 17. Contoh Policy Dokumen Tim

```markdown
# Git Workflow Policy

## Branches

- `main` is the primary integration branch.
- `main` must always be buildable and deployable to non-production.
- Feature branches must be short-lived and named `feature/<ticket>-<summary>`.
- Bugfix branches use `bugfix/<ticket>-<summary>`.
- Hotfix branches use `hotfix/<incident>-<summary>` and must start from the production tag.
- Release branches use `release/<version>` and are created only after release cutoff.

## Pull Requests

- All changes to `main` require PR.
- PR must pass CI.
- PR should be small and focused.
- PR must include test evidence or a reason why no test is needed.
- Database migration PRs require backend lead review.
- API contract changes require consumer impact review.

## Merge Strategy

- Default merge strategy: squash merge for feature branches.
- Merge commit may be used for release branches or multi-commit feature narratives.
- Force push to shared protected branches is forbidden.

## Releases

- Production releases are created from annotated tags.
- Release artifact version must include or map to Git commit SHA.
- Release branches accept only stabilization fixes.

## Hotfixes

- Hotfix must start from production tag.
- Hotfix must be merged/cherry-picked back to `main`.
- Hotfix PR must link to incident record.
```

---

## 18. Latihan Praktis

### Latihan 1 — Simulasi GitHub Flow

```bash
mkdir git-workflow-lab
cd git-workflow-lab
git init
git branch -M main

cat > README.md <<'EOF'
# Git Workflow Lab
EOF

git add README.md
git commit -m "docs: initialize lab"

git switch -c feature/add-case-service
mkdir -p src/main/java/com/example/caseapp
cat > src/main/java/com/example/caseapp/CaseService.java <<'EOF'
package com.example.caseapp;

public class CaseService {
    public String status() {
        return "OPEN";
    }
}
EOF

git add .
git commit -m "feat: add case service skeleton"

git switch main
git merge --no-ff feature/add-case-service -m "merge: add case service skeleton"
```

Observasi:

```bash
git log --oneline --graph --decorate --all
```

### Latihan 2 — Simulasi Release Branch

```bash
git switch -c release/1.0

echo "1.0.0" > VERSION
git add VERSION
git commit -m "chore: prepare release 1.0.0"

git tag -a v1.0.0 -m "Release v1.0.0"
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

### Latihan 3 — Simulasi Hotfix dari Tag

```bash
git switch -c hotfix/INC-001 v1.0.0

echo "hotfix applied" >> README.md
git add README.md
git commit -m "fix: apply production hotfix"

git tag -a v1.0.1 -m "Hotfix release v1.0.1"
```

Reconcile ke main:

```bash
git switch main
git cherry-pick hotfix/INC-001
```

Observasi:

```bash
git log --oneline --graph --decorate --all
```

---

## 19. Pertanyaan Reflektif

Gunakan pertanyaan ini untuk menilai workflow tim:

1. Branch mana yang menjadi source of truth?
2. Apakah `main` selalu hijau?
3. Berapa median umur feature branch?
4. Berapa ukuran rata-rata PR?
5. Apakah release dibuat dari commit/tag yang jelas?
6. Apakah hotfix selalu dikembalikan ke main?
7. Apakah environment branch digunakan sebagai source code branch atau promotion marker?
8. Apakah CI cukup cepat untuk mendukung integrasi sering?
9. Apakah fitur besar bisa disembunyikan dengan feature flag?
10. Apakah audit trail dari requirement → PR → commit → build → deployment jelas?
11. Apakah workflow membantu engineer, atau hanya menambah ritual?
12. Apakah workflow akan tetap aman saat incident production terjadi pukul 02:00?

---

## 20. Checklist Memilih Workflow

```text
[ ] Tentukan makna main/trunk.
[ ] Tentukan apakah main harus buildable atau deployable.
[ ] Tentukan release cadence.
[ ] Tentukan apakah release branch benar-benar dibutuhkan.
[ ] Tentukan apakah multiple supported versions dibutuhkan.
[ ] Tentukan hotfix path dari production tag.
[ ] Tentukan merge strategy default.
[ ] Tentukan branch protection.
[ ] Tentukan PR size expectation.
[ ] Tentukan CI checks wajib.
[ ] Tentukan policy feature flag.
[ ] Tentukan backport policy.
[ ] Tentukan tagging/versioning policy.
[ ] Tentukan evidence/audit requirement.
[ ] Dokumentasikan workflow dalam repository.
```

---

## 21. Kesimpulan

Git workflow bukan agama. Ia adalah desain sistem kerja.

Trunk-based dan GitHub Flow menekankan:

```text
small changes, frequent integration, fast feedback
```

Git Flow menekankan:

```text
structured release, stabilization, hotfix path, versioned maintenance
```

GitLab Flow mencoba memberi fleksibilitas:

```text
simple mainline flow plus release/environment handling when needed
```

Pilihan terbaik tergantung pada constraint tim.

Untuk banyak tim Java backend modern, pilihan awal yang kuat adalah:

```text
protected main
short-lived feature branches
PR required
CI required
release tags
release branches only when truly needed
hotfix from production tag
```

Prinsip paling penting:

```text
Jangan gunakan branch untuk menunda integrasi yang seharusnya diselesaikan lewat desain, testing, feature flag, dan release control.
```

Git workflow yang baik membuat risiko terlihat lebih awal, bukan menyembunyikannya sampai hari release.

---

## 22. Rujukan

Rujukan utama untuk bagian ini:

- GitHub Docs — GitHub Flow.
- GitLab Docs — Branching strategies dan GitLab Flow.
- Trunk Based Development — short-lived feature branches dan branch by abstraction.
- Atlassian Git Tutorial — Gitflow Workflow.
- Dokumentasi resmi Git untuk branch, merge, tag, dan remote operation yang telah dibahas pada bagian sebelumnya.

---

## 23. Status Seri

```text
Progress: 014 / 032
Status: belum selesai
Bagian berikutnya: learn-git-mastery-for-java-engineers-part-015.md
Topik berikutnya: Release, Tagging, Versioning, dan Hotfix
Bagian terakhir: learn-git-mastery-for-java-engineers-part-032.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-git-mastery-for-java-engineers-part-013.md](./learn-git-mastery-for-java-engineers-part-013.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-git-mastery-for-java-engineers-part-015.md](./learn-git-mastery-for-java-engineers-part-015.md)
