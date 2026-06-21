# learn-docker-mastery-for-java-engineers-part-027

# Local Developer Platform: Docker as Team Workflow Contract

> Seri: `learn-docker-mastery-for-java-engineers`  
> Part: `027`  
> Target pembaca: Java software engineer / tech lead  
> Fokus: Docker sebagai kontrak workflow tim, bukan sekadar command individual  
> Status seri: belum selesai

---

## 0. Posisi Part Ini dalam Seri

Sampai part sebelumnya, kita sudah membahas Docker dari sudut pandang runtime, image, Dockerfile, Compose, healthcheck, secrets, security, supply chain, performance, logging, debugging, testing, CI/CD, multi-platform image, dan perbedaan Docker Desktop dengan Linux server.

Part ini naik satu level.

Di sini Docker tidak diposisikan sebagai:

```text
alat untuk menjalankan container secara manual
```

melainkan sebagai:

```text
kontrak workflow tim untuk membuat environment lokal dapat diprediksi, dapat di-reset, dapat didiagnosis, dan dapat dipakai lintas developer dengan sedikit tribal knowledge.
```

Untuk engineer senior atau tech lead, nilai Docker sering bukan hanya “bisa run app di laptop”, tetapi:

1. developer baru bisa onboarding tanpa membaca dokumen setup 3 hari,
2. dependency lokal tidak saling bentrok,
3. service dependency punya nama, port, volume, dan lifecycle yang konsisten,
4. environment bisa di-reset tanpa menghancurkan laptop,
5. bug lokal bisa direproduksi oleh anggota tim lain,
6. command developer harian punya interface yang stabil,
7. local environment cukup mirip production untuk menangkap masalah penting, tetapi tidak pura-pura menjadi production.

Docker Compose documentation sendiri menempatkan Compose sebagai cara mendefinisikan dan menjalankan aplikasi multi-container; Compose file berisi definisi services, networks, volumes, configs, secrets, dan sebagainya. Docker juga menyediakan Compose profiles untuk mengaktifkan service tertentu hanya pada use case tertentu, dan Compose Watch/develop specification untuk workflow development yang melakukan sync/rebuild saat source berubah. Referensi resmi yang relevan: Docker Compose services, profiles, environment variable best practices, secrets, Compose Watch, dan develop specification.

---

## 1. Masalah yang Sebenarnya Diselesaikan oleh Local Developer Platform

Banyak tim mengira masalahnya adalah:

```text
Bagaimana cara menjalankan aplikasi di laptop?
```

Pertanyaan itu terlalu sempit.

Masalah yang lebih benar adalah:

```text
Bagaimana semua engineer di tim dapat menjalankan, menguji, mengubah, mereset, dan mendiagnosis sistem lokal dengan cara yang sama, tanpa harus memahami seluruh sejarah konfigurasi setiap dependency?
```

Docker membantu bukan karena Docker ajaib, tetapi karena Docker memberi boundary dan kontrak:

| Problem tim | Kontrak Docker/Compose yang membantu |
|---|---|
| Dependency berbeda versi antar laptop | image tag/digest dan Compose service definition |
| Port bentrok | port mapping eksplisit dan profile |
| Database lokal rusak | named volume reset strategy |
| Service dependency tidak jelas | Compose topology |
| Env var tersebar di chat | `.env.example` dan config contract |
| Setup onboarding panjang | satu command entrypoint |
| “Works on my machine” | project name, network, image, and volume convention |
| Debug sulit | logs, inspect, health, events, reset command |
| Secret bocor | secret file dan ignored local env |
| Corporate proxy/cert chaos | documented bootstrap hook |

Local developer platform bukan berarti membuat platform engineering besar. Untuk banyak tim Java, local developer platform bisa sesederhana:

```text
repo/
  compose.yaml
  compose.override.yaml
  compose.test.yaml
  .env.example
  .dockerignore
  Dockerfile
  scripts/dev
  scripts/reset
  scripts/logs
  docs/local-dev.md
```

Yang penting bukan banyaknya file. Yang penting adalah semua file itu mendefinisikan kontrak yang dapat dioperasikan.

---

## 2. Mental Model: Local Environment sebagai Sistem, Bukan Sekumpulan Container

Container individual mudah dipahami. Masalah muncul ketika container menjadi sistem.

Contoh sistem lokal Java backend:

```text
Java API
  depends on PostgreSQL
  depends on Redis
  depends on Kafka
  depends on WireMock
  depends on Mailpit
  exposes HTTP port
  runs migrations
  reads config
  writes temp file
  emits logs
```

Kalau setiap engineer menjalankan dependency dengan cara sendiri, maka environment lokal menjadi implicit system. Docker Compose membuatnya explicit system.

Mental model yang bagus:

```text
compose.yaml = topology contract
.env.example = configuration contract
Dockerfile = application artifact contract
scripts/dev = workflow contract
named volumes = state contract
profiles = optional capability contract
healthcheck = readiness contract
README/docs = human contract
```

Jadi Compose bukan hanya “file untuk docker compose up”. Compose adalah dokumentasi executable tentang bagaimana sistem lokal dibentuk.

---

## 3. Batas Penting: Local Platform Bukan Production Clone

Salah satu kesalahan paling mahal adalah memaksa local environment menjadi replika production.

Itu hampir selalu gagal karena production punya:

1. load balancer,
2. managed database,
3. network policy,
4. secret manager,
5. autoscaling,
6. centralized logging,
7. TLS termination,
8. service mesh,
9. IAM,
10. observability pipeline,
11. deployment orchestrator,
12. backup dan restore policy,
13. compliance boundary.

Local Docker environment tidak harus meniru semua itu.

Target yang lebih realistis:

```text
Local environment harus cukup mirip production untuk menangkap bug integrasi, config, dependency, network, startup, migration, dan lifecycle yang relevan; tetapi cukup ringan agar bisa dipakai setiap hari oleh developer.
```

Dengan kata lain:

| Production concern | Local equivalent yang cukup |
|---|---|
| Managed PostgreSQL | PostgreSQL container dengan init/migration |
| Kafka cluster | single-node broker atau compatible lightweight setup |
| Secret manager | local secret file ignored from git |
| Observability platform | structured stdout + optional local collector profile |
| Kubernetes readiness | Compose healthcheck + app health endpoint |
| TLS ingress | optional local TLS proxy only when needed |
| IAM/cloud identity | local mock/stub/token fixture |
| Multi-node failure | biasanya tidak perlu di local dev |

Prinsipnya:

```text
Reproduce contracts, not infrastructure theater.
```

Yang perlu direproduksi adalah kontrak aplikasi terhadap dependency, bukan semua bentuk production topology.

---

## 4. Local Developer Platform Maturity Model

Kita bisa melihat kematangan Docker local workflow dalam beberapa level.

### Level 0 — Manual Chaos

Ciri:

- setiap developer install PostgreSQL sendiri,
- versi Java berbeda,
- Redis kadang pakai brew, kadang Docker,
- port ditentukan dari ingatan,
- env var disimpan di chat,
- dokumentasi setup cepat basi,
- bug lokal sulit direproduksi.

Command tipikal:

```bash
java -jar target/app.jar
```

lalu banyak langkah manual sebelumnya.

### Level 1 — Containerized Dependencies

Ciri:

- app masih jalan di host,
- database/broker/cache jalan via Compose,
- `.env.example` mulai ada,
- dependency lebih stabil,
- debugging masih campur host dan container.

Ini sering level paling produktif untuk Java backend karena IDE tetap berjalan native di host, sementara infra dependency distandardisasi.

### Level 2 — Containerized App + Dependencies

Ciri:

- app juga dijalankan sebagai container,
- Dockerfile dev/prod mulai dirancang,
- hot reload perlu strategi,
- debugging perlu port debug,
- file sync/bind mount perlu diperhatikan,
- lebih dekat ke production image.

### Level 3 — Workflow Contract

Ciri:

- ada command konsisten:
  - `dev up`,
  - `dev down`,
  - `dev reset`,
  - `dev logs`,
  - `dev test`,
  - `dev migrate`,
  - `dev seed`,
- `.env.example` jelas,
- profiles dipakai,
- reset state terdokumentasi,
- onboarding bisa dilakukan cepat,
- healthcheck tersedia,
- failure mode umum punya playbook.

### Level 4 — Team Platform

Ciri:

- local platform diperlakukan sebagai produk internal kecil,
- ada ownership,
- ada compatibility policy,
- ada update cadence,
- ada troubleshooting guide,
- ada support untuk proxy/VPN/cert,
- ada test automation yang memakai environment serupa,
- dependency image di-pin,
- local workflow masuk ke CI smoke test.

Untuk kebanyakan tim, target sehat adalah Level 3. Level 4 diperlukan bila organisasi sudah cukup besar atau sistemnya kompleks.

---

## 5. Prinsip Desain Local Platform yang Baik

### 5.1 Default Path Harus Mudah

Developer baru seharusnya tidak perlu menebak.

Idealnya:

```bash
cp .env.example .env
./dev up
```

atau:

```bash
make up
```

atau:

```bash
docker compose up --wait
```

Command boleh berbeda, tetapi entrypoint harus jelas.

Kalau README berisi 40 langkah manual, berarti platform belum menjadi platform. Itu hanya catatan operasi.

### 5.2 Explicit Beats Implicit

Jangan mengandalkan asumsi seperti:

- “Postgres harus sudah jalan di port 5432”,
- “Redis install pakai brew”,
- “Kafka pakai versi yang ini ya”,
- “env var tanya senior”,
- “folder cert ada di home masing-masing”.

Jadikan eksplisit:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
```

### 5.3 Reset Harus Aman dan Cepat

Environment lokal pasti rusak.

Database schema stale, migration gagal, broker topic kotor, volume permission berubah, cache corrupted, index search inconsistent.

Karena itu workflow harus punya reset.

Contoh:

```bash
./dev reset
```

yang mungkin menjalankan:

```bash
docker compose down --remove-orphans
docker compose down --volumes
docker compose up -d --wait
./dev migrate
./dev seed
```

Tapi reset harus jelas scope-nya.

Bedakan:

```text
soft reset  = recreate container, keep volumes
hard reset  = remove volumes, recreate state
nuke reset  = remove images/cache/orphans too
```

Jangan membuat `reset` yang diam-diam menghapus data penting tanpa peringatan.

### 5.4 Local Platform Harus Bisa Didiagnosis

Kalau hanya ada `up`, tetapi tidak ada cara melihat status, platformnya belum lengkap.

Minimal command:

```bash
./dev status
./dev logs
./dev logs api
./dev ps
./dev inspect api
./dev doctor
```

Diagnosis adalah bagian dari developer experience.

### 5.5 Jangan Menyembunyikan Docker Terlalu Banyak

Wrapper script berguna, tetapi jangan sampai developer kehilangan visibilitas.

Wrapper yang buruk:

```bash
./start-everything
```

lalu jika gagal hanya muncul:

```text
Error occurred
```

Wrapper yang baik:

```bash
./dev up
```

menampilkan command Docker yang dijalankan atau menyediakan mode verbose:

```bash
./dev up --verbose
```

Tujuannya bukan mengabstraksi Docker sepenuhnya, tetapi menyederhanakan jalur umum sambil tetap menjaga debuggability.

---

## 6. Repository Layout yang Sehat

Tidak ada satu struktur yang wajib, tetapi pola berikut cukup robust untuk Java service.

```text
repo-root/
  Dockerfile
  .dockerignore
  compose.yaml
  compose.override.yaml
  compose.test.yaml
  .env.example
  README.md
  docs/
    local-development.md
    troubleshooting.md
  scripts/
    dev
    reset-local-state
    wait-for-health
  src/
  pom.xml / build.gradle
```

Atau dengan direktori infra:

```text
repo-root/
  docker/
    compose.yaml
    compose.override.yaml
    compose.test.yaml
    postgres/
      init/
    wiremock/
      mappings/
    mailpit/
    certs/
  scripts/
    dev
  .env.example
  Dockerfile
```

Trade-off:

| Layout | Kelebihan | Kekurangan |
|---|---|---|
| Compose di root | mudah ditemukan | root bisa ramai |
| Compose di `docker/` | infra lokal rapi | command perlu `-f docker/compose.yaml` |
| Script wrapper | command pendek | harus dijaga kualitasnya |
| Makefile | familiar di banyak tim | tidak semua OS nyaman tanpa tooling |
| Shell script | fleksibel | Windows perlu perhatian |
| Task runner khusus | UX bagus | dependency tambahan |

Untuk tim lintas OS, jangan mengasumsikan Bash tersedia sempurna di semua mesin. Jika tim mayoritas Windows, WSL2 perlu dijadikan jalur resmi atau sediakan wrapper alternatif.

---

## 7. `.env.example` sebagai Kontrak, Bukan Tempat Rahasia

`.env.example` harus berisi daftar variabel yang dibutuhkan, default lokal yang aman, dan komentar penjelasan.

Contoh:

```dotenv
# Application
APP_PORT=8080
SPRING_PROFILES_ACTIVE=local

# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=app
DB_USER=app
DB_PASSWORD=app

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# External API mock
PAYMENT_API_BASE_URL=http://wiremock:8080

# Optional: enable remote debugging
JAVA_DEBUG_PORT=5005
```

Jangan commit `.env` yang berisi secret sungguhan.

Gunakan pola:

```text
.env.example   committed
.env           ignored
.env.local     ignored
secrets/       ignored, kecuali README/template
```

Docker Compose documentation memperingatkan agar berhati-hati memakai environment variable untuk data sensitif dan mempertimbangkan secrets untuk mengelola secret. Compose juga memiliki precedence environment variable; ini penting karena nilai bisa berasal dari shell, `.env`, `environment`, `env_file`, atau CLI override.

Praktik sehat:

```gitignore
.env
.env.*
!.env.example
secrets/*
!secrets/README.md
!secrets/*.example
```

---

## 8. Compose Profiles sebagai Capability Switch

Tidak semua dependency harus selalu jalan.

Contoh service optional:

- Kafka,
- Elasticsearch,
- observability stack,
- local admin UI,
- mock external service,
- browser automation,
- load-test tooling.

Docker Compose profiles memungkinkan service tertentu hanya aktif ketika profile dipilih. Services tanpa profile berjalan default; services dengan profile hanya berjalan ketika profile aktif.

Contoh:

```yaml
services:
  api:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

  postgres:
    image: postgres:16
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7

  kafka:
    image: apache/kafka:latest
    profiles: ["kafka"]

  mailpit:
    image: axllent/mailpit:latest
    profiles: ["mail"]

  wiremock:
    image: wiremock/wiremock:latest
    profiles: ["mock"]
```

Jalankan minimal:

```bash
docker compose up -d --wait
```

Jalankan dengan Kafka:

```bash
docker compose --profile kafka up -d --wait
```

Jalankan semua capability dev:

```bash
docker compose --profile kafka --profile mail --profile mock up -d --wait
```

Kelebihan:

1. laptop developer tidak dipaksa menjalankan dependency berat,
2. topology tetap satu sumber,
3. optional service tidak hilang dari dokumentasi,
4. command dapat distandardisasi.

---

## 9. Compose Override Strategy

Compose mendukung multiple files. Pola umum:

```text
compose.yaml              baseline shared topology
compose.override.yaml     local developer default override
compose.test.yaml         test-specific topology
compose.ci.yaml           CI-specific override
compose.debug.yaml        debugging profile/ports/tools
```

Contoh baseline:

```yaml
# compose.yaml
services:
  api:
    image: myorg/myapp:${APP_VERSION:-local}
    environment:
      SPRING_PROFILES_ACTIVE: ${SPRING_PROFILES_ACTIVE:-local}
      DB_HOST: postgres
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  postgres-data:
```

Local override:

```yaml
# compose.override.yaml
services:
  api:
    build:
      context: .
    ports:
      - "8080:8080"
      - "5005:5005"
    environment:
      JAVA_TOOL_OPTIONS: >-
        -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
```

Test override:

```yaml
# compose.test.yaml
services:
  api:
    environment:
      SPRING_PROFILES_ACTIVE: test
  postgres:
    tmpfs:
      - /var/lib/postgresql/data
```

Prinsip penting:

```text
Baseline file harus mendeskripsikan topology utama. Override file hanya mengubah konteks pemakaian.
```

Jangan membuat setiap file Compose menjadi dunia terpisah yang tidak sinkron.

---

## 10. Command UX: Satu Pintu untuk Workflow Harian

Developer harian tidak seharusnya mengingat command panjang.

Buat satu entrypoint, misalnya `./dev`.

Contoh interface:

```bash
./dev up
./dev down
./dev restart
./dev reset
./dev reset --hard
./dev logs
./dev logs api
./dev ps
./dev status
./dev migrate
./dev seed
./dev test
./dev doctor
./dev pull
./dev build
```

Atau Makefile:

```makefile
.PHONY: up down reset logs ps test doctor

up:
	docker compose up -d --wait

down:
	docker compose down --remove-orphans

reset:
	docker compose down --remove-orphans --volumes
	docker compose up -d --wait

logs:
	docker compose logs -f --tail=200

ps:
	docker compose ps

test:
	./mvnw test

doctor:
	./scripts/dev doctor
```

Wrapper harus memenuhi syarat:

1. command jelas,
2. error keluar apa adanya,
3. tidak menelan exit code,
4. punya help,
5. mendukung verbose,
6. aman terhadap destructive operation,
7. tidak menyimpan secret.

Contoh help:

```text
Usage: ./dev <command>

Commands:
  up              Start local dependencies and app
  down            Stop containers, keep volumes
  reset           Recreate containers, keep durable data
  reset --hard    Remove volumes and recreate local data
  logs [service]  Tail logs
  ps              Show service status
  doctor          Check Docker, ports, env, and required files
  test            Run test suite
```

---

## 11. `dev doctor`: Tool Kecil yang Menghemat Banyak Waktu

Banyak masalah local setup berulang:

- Docker tidak jalan,
- versi Compose terlalu lama,
- port 8080 sudah dipakai,
- `.env` belum dibuat,
- secret file hilang,
- VPN mati,
- corporate CA belum dipasang,
- disk Docker penuh,
- image belum dipull,
- architecture mismatch,
- volume stale.

Buat command:

```bash
./dev doctor
```

Checklist yang bisa diperiksa:

```text
[OK] Docker daemon reachable
[OK] Docker Compose version >= required
[OK] .env exists
[OK] required secret files exist
[OK] port 8080 available
[OK] port 5432 available or mapped intentionally
[OK] enough disk space
[OK] expected platform linux/amd64 or linux/arm64
[WARN] VPN not detected
[WARN] corporate CA missing
[OK] project containers healthy
```

Pseudo-script:

```bash
#!/usr/bin/env bash
set -euo pipefail

required_files=(".env")
required_ports=("8080" "5432")

check_docker() {
  docker info >/dev/null
}

check_compose() {
  docker compose version >/dev/null
}

check_files() {
  for f in "${required_files[@]}"; do
    test -f "$f" || { echo "Missing required file: $f"; exit 1; }
  done
}

check_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null; then
      echo "Port $port is already in use"
    fi
  fi
}

check_docker
check_compose
check_files
for p in "${required_ports[@]}"; do check_port "$p"; done

echo "Local environment checks completed"
```

Ini bukan pengganti pemahaman Docker. Ini guardrail untuk mengurangi waktu hilang.

---

## 12. Naming Convention: Project, Service, Volume, Network

Tanpa convention, local environment cepat berantakan.

### 12.1 Compose Project Name

Compose project name memengaruhi nama container, network, dan volume.

Default biasanya berdasarkan nama direktori. Ini bisa membuat dua clone repo saling bentrok atau menghasilkan nama yang tidak konsisten.

Gunakan `.env`:

```dotenv
COMPOSE_PROJECT_NAME=myapp
```

Atau wrapper:

```bash
docker compose -p myapp up -d
```

Untuk multi-branch parallel development:

```bash
COMPOSE_PROJECT_NAME=myapp_${USER}_feature_x
```

Tapi hati-hati: nama dinamis membuat volume lama mudah tertinggal.

### 12.2 Service Name

Gunakan service name yang merepresentasikan role:

```yaml
services:
  api:
  postgres:
  redis:
  kafka:
  wiremock:
  mailpit:
```

Jangan gunakan nama personal atau environment-specific:

```yaml
services:
  john-db:
  staging-copy:
  temp-api-2:
```

### 12.3 Volume Name

Gunakan nama yang menunjukkan state:

```yaml
volumes:
  postgres-data:
  redis-data:
  kafka-data:
```

Bukan:

```yaml
volumes:
  data:
  stuff:
  volume1:
```

### 12.4 Network Name

Biasanya default network cukup. Buat custom network bila ada alasan:

- perlu memisahkan dependency,
- perlu menghubungkan beberapa Compose project,
- perlu nama network stabil,
- perlu advanced topology.

Default dulu, custom bila perlu.

---

## 13. State Management: Persistent, Ephemeral, Seeded, Disposable

Tidak semua state lokal sama.

Klasifikasikan:

| State | Contoh | Strategy |
|---|---|---|
| Persistent dev data | database lokal manual | named volume |
| Ephemeral test data | integration test DB | tmpfs/anonymous volume/Testcontainers |
| Seeded fixture | sample user/product/case | migration + seed script |
| Generated cache | Redis/local cache | disposable volume |
| Artifact output | reports/uploads | bind mount atau named volume |
| Secret material | cert/key/token | ignored file mount/secret |

Kesalahan umum:

```text
Semua state diperlakukan sebagai persistent.
```

Akibatnya:

- migration sulit diuji,
- stale schema bertahan,
- bug fixture tidak terlihat,
- reset berisiko,
- developer takut membersihkan volume.

Desain yang lebih baik:

```text
State yang harus tahan reset ringan -> named volume.
State yang harus bersih setiap test -> ephemeral.
State yang harus dapat direkonstruksi -> migration + seed.
State yang rahasia -> file secret ignored.
```

---

## 14. Migration dan Seed Data sebagai Workflow First-Class

Untuk Java backend, database lokal hampir selalu butuh migration dan seed.

Jangan biarkan setiap developer menjalankan SQL manual.

Pola:

```bash
./dev migrate
./dev seed
./dev reset --hard
```

Dengan Flyway/Liquibase misalnya:

```bash
./mvnw flyway:migrate \
  -Dflyway.url=jdbc:postgresql://localhost:5432/app \
  -Dflyway.user=app \
  -Dflyway.password=app
```

Atau service migration di Compose:

```yaml
services:
  migrate:
    build: .
    command: ["./mvnw", "flyway:migrate"]
    depends_on:
      postgres:
        condition: service_healthy
    profiles: ["tools"]
```

Run:

```bash
docker compose --profile tools run --rm migrate
```

Pertimbangan:

| Pendekatan | Kelebihan | Kekurangan |
|---|---|---|
| Migration dari host | cepat dengan IDE/tooling lokal | host butuh Java/build tool |
| Migration containerized | lebih konsisten | build image dulu, lebih lambat |
| App auto-migrate on startup | simpel | risiko startup coupling dan race |
| Dedicated migration service | explicit | butuh command tambahan |

Untuk tim besar, dedicated migration command biasanya lebih jelas.

---

## 15. Hot Reload dan Inner Loop Java

Developer productivity banyak ditentukan oleh inner loop:

```text
edit -> build -> run -> observe -> fix
```

Docker bisa mempercepat atau memperlambat inner loop tergantung desain.

### 15.1 App Jalan di Host, Dependency di Docker

Pola:

```text
IDE runs Java app on host
Docker Compose runs PostgreSQL/Redis/Kafka/etc.
```

Kelebihan:

- debugging IDE mudah,
- hot reload Spring DevTools mudah,
- filesystem native cepat,
- tidak perlu rebuild image setiap edit.

Kekurangan:

- runtime tidak sepenuhnya sama dengan container,
- env host bisa bocor,
- Java version host harus distandardisasi.

Ini sering pilihan terbaik untuk daily backend development.

### 15.2 App Jalan di Container dengan Bind Mount

Pola:

```yaml
services:
  api:
    build:
      context: .
      target: dev
    volumes:
      - .:/workspace
    command: ./mvnw spring-boot:run
```

Kelebihan:

- toolchain Java bisa distandardisasi,
- semua berjalan di container,
- onboarding lebih konsisten.

Kekurangan:

- mount performance bisa buruk di macOS/Windows,
- file permission bisa rumit,
- IDE integration perlu perhatian,
- build cache bisa kurang optimal.

### 15.3 Compose Watch / Develop

Docker Compose Watch dapat menyinkronkan atau melakukan rebuild ketika file berubah. Compose Develop Specification mendefinisikan bagian `develop` dan `watch` untuk workflow development di Compose versi modern.

Contoh konseptual:

```yaml
services:
  api:
    build: .
    develop:
      watch:
        - action: rebuild
          path: ./pom.xml
        - action: sync
          path: ./src
          target: /workspace/src
```

Gunakan jika:

- tim ingin app berjalan dalam container,
- rebuild/sync behavior bisa diprediksi,
- Docker Compose version cukup baru,
- workflow sudah diuji di OS yang dipakai tim.

Jangan gunakan hanya karena fitur baru. Ukur inner loop.

---

## 16. Remote Debugging Java di Docker

Remote debug berguna, tetapi harus diperlakukan sebagai local-only capability.

Contoh:

```yaml
services:
  api:
    ports:
      - "8080:8080"
      - "5005:5005"
    environment:
      JAVA_TOOL_OPTIONS: >-
        -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
    profiles: ["debug"]
```

Run:

```bash
docker compose --profile debug up -d --wait
```

Jangan expose debug port dalam production Compose/manifest.

Risiko:

- remote code execution via debug protocol,
- application pause jika `suspend=y`,
- port collision,
- security scanner finding,
- accidental exposure di shared network.

Prinsip:

```text
Debug port adalah development capability, bukan runtime default.
```

---

## 17. Corporate Proxy, VPN, Private Registry, dan CA Certificates

Ini bagian yang sering diabaikan, padahal sangat nyata di perusahaan.

Masalah umum:

1. Docker tidak bisa pull image karena proxy,
2. Maven tidak bisa download dependency,
3. app tidak trust corporate TLS certificate,
4. private registry butuh login,
5. VPN mengubah DNS,
6. container tidak bisa resolve internal hostname,
7. Docker Desktop VM tidak mewarisi setting host seperti yang diasumsikan,
8. certificate dipasang di host tetapi tidak ada di image.

Local platform yang matang harus punya section khusus:

```text
Corporate setup:
- Docker login registry internal
- Configure proxy for Docker Desktop/Engine
- Configure Maven/Gradle proxy
- Install corporate CA into Java truststore or mount truststore
- Validate VPN/DNS with ./dev doctor
```

### 17.1 Registry Login

```bash
docker login registry.company.example
```

Jangan masukkan credential ke Compose file.

### 17.2 Proxy untuk Build

Build args bisa dipakai, tetapi hati-hati jangan membocorkan proxy credential.

```bash
docker build \
  --build-arg HTTP_PROXY=$HTTP_PROXY \
  --build-arg HTTPS_PROXY=$HTTPS_PROXY \
  .
```

Lebih baik gunakan konfigurasi Docker/client yang sesuai kebijakan perusahaan.

### 17.3 CA Certificate

Untuk Java, TLS trust bukan hanya OS certificate. JVM punya truststore sendiri tergantung distribution/config.

Strategi:

| Strategy | Kapan dipakai |
|---|---|
| Bake CA ke dev image | dev-only image internal |
| Mount truststore | secret/cert berbeda per developer |
| Configure JVM truststore env | perlu eksplisit dan auditable |
| Use company base image | organisasi besar dengan platform team |

Contoh env:

```dotenv
JAVA_TOOL_OPTIONS=-Djavax.net.ssl.trustStore=/run/secrets/truststore.jks -Djavax.net.ssl.trustStorePassword=changeit
```

Jangan commit truststore rahasia.

---

## 18. Dev Containers: Kapan Masuk Akal?

Dev container adalah pendekatan di mana editor/IDE membuka workspace di dalam container. VS Code Dev Containers misalnya memungkinkan folder dibuka di dalam container sebagai development environment lengkap.

Gunakan dev container jika:

- toolchain sulit distandardisasi di host,
- banyak dependency CLI,
- onboarding sering gagal karena OS berbeda,
- tim rela bekerja dengan IDE integration container,
- filesystem performance acceptable,
- dependency image dikelola dengan baik.

Jangan gunakan dev container jika:

- tim belum punya Docker workflow stabil,
- inner loop jadi terlalu lambat,
- debugging jadi lebih sulit,
- developer memakai IDE yang tidak mendukung baik,
- masalah sebenarnya adalah dokumentasi/setup yang buruk.

Dev container bukan pengganti desain Compose yang baik. Ia hanya salah satu cara menjalankan developer environment.

---

## 19. Port Strategy: Hindari Bentrok dan Ambiguitas

Port lokal adalah sumber friction besar.

Contoh konflik:

- banyak service memakai 8080,
- PostgreSQL host sudah ada di 5432,
- Redis host sudah ada di 6379,
- Kafka banyak port,
- debug port 5005 bentrok.

Strategi:

### 19.1 Fixed Default Port

```yaml
ports:
  - "8080:8080"
```

Kelebihan:

- mudah diingat,
- dokumentasi sederhana,
- cocok untuk single project.

Kekurangan:

- bentrok jika banyak project.

### 19.2 Configurable Host Port

```yaml
ports:
  - "${APP_HOST_PORT:-8080}:8080"
```

`.env.example`:

```dotenv
APP_HOST_PORT=8080
POSTGRES_HOST_PORT=5432
REDIS_HOST_PORT=6379
```

Kelebihan:

- developer bisa override.

Kekurangan:

- dokumentasi URL harus membaca env.

### 19.3 No Host Port untuk Internal Dependency

Jika app juga berjalan di Compose network, dependency tidak perlu expose ke host.

```yaml
postgres:
  image: postgres:16
  expose:
    - "5432"
```

Atau tidak perlu `expose` sama sekali untuk komunikasi service-to-service di user-defined network.

Gunakan host port hanya jika developer perlu akses langsung dari host tool seperti IDE DB client.

---

## 20. Dependency Access Pattern untuk Java App

Ada dua mode umum.

### 20.1 App di Host, Dependencies di Container

App config:

```dotenv
DB_HOST=localhost
DB_PORT=5432
REDIS_HOST=localhost
REDIS_PORT=6379
```

Compose:

```yaml
postgres:
  ports:
    - "5432:5432"
redis:
  ports:
    - "6379:6379"
```

### 20.2 App di Container, Dependencies di Container

App config:

```dotenv
DB_HOST=postgres
DB_PORT=5432
REDIS_HOST=redis
REDIS_PORT=6379
```

Compose:

```yaml
api:
  depends_on:
    postgres:
      condition: service_healthy
postgres:
  # no host port required for api-to-postgres
```

Kesalahan umum:

```text
App di container memakai DB_HOST=localhost
```

Di dalam container, `localhost` berarti container itu sendiri, bukan service PostgreSQL.

Untuk mengurangi kebingungan, pisahkan env file:

```text
.env.host-app
.env.container-app
```

atau gunakan profile yang jelas.

---

## 21. Local Mocking: Jangan Selalu Memanggil External System

Local platform harus mengurangi ketergantungan ke sistem eksternal.

External dependency yang cocok dimock/stub:

- payment gateway,
- email provider,
- SMS provider,
- document signing,
- identity provider,
- internal service lain yang tidak selalu stabil,
- third-party API dengan rate limit.

Tools umum:

- WireMock untuk HTTP stubbing,
- MockServer,
- Mailpit/MailHog untuk email,
- LocalStack untuk sebagian AWS-like workflow,
- MinIO untuk S3-compatible object storage.

Prinsip:

```text
Mock external side effect. Jangan mock dependency yang justru ingin diuji kontraknya.
```

Contoh Compose:

```yaml
services:
  wiremock:
    image: wiremock/wiremock:latest
    volumes:
      - ./docker/wiremock/mappings:/home/wiremock/mappings:ro
    ports:
      - "8089:8080"
    profiles: ["mock"]

  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "8025:8025"
      - "1025:1025"
    profiles: ["mail"]
```

App env:

```dotenv
PAYMENT_API_BASE_URL=http://wiremock:8080
SMTP_HOST=mailpit
SMTP_PORT=1025
```

---

## 22. Data Fixture: Realistic Enough, Small Enough

Seed data lokal harus seimbang.

Kalau terlalu kecil:

- edge case tidak muncul,
- pagination tidak diuji,
- role/permission tidak terlihat,
- status lifecycle tidak lengkap.

Kalau terlalu besar:

- startup lambat,
- reset mahal,
- developer takut reset,
- debugging sulit.

Fixture yang baik mencakup:

1. happy path entity,
2. invalid/failed state,
3. pending state,
4. boundary date,
5. multiple user role,
6. realistic relationship,
7. small but representative volume.

Untuk sistem case management/regulatory-style workflow, fixture lokal sebaiknya punya:

```text
case_draft
case_submitted
case_under_review
case_escalated
case_closed
case_reopened
case_with_missing_document
case_with_conflicting_assignment
case_past_due
```

Ini jauh lebih berguna daripada 1.000 row random tanpa makna.

---

## 23. Local Platform dan Domain Workflow

Untuk sistem kompleks, local platform tidak hanya menjalankan dependency teknis. Ia harus membantu engineer melihat workflow domain.

Misalnya service enforcement lifecycle:

```text
intake -> validation -> assignment -> investigation -> escalation -> decision -> notification -> closure -> appeal/reopen
```

Docker local environment dapat menyediakan:

- seed case di setiap state,
- mock external registry response,
- fake clock/time-control profile,
- email sink untuk notification,
- object storage lokal untuk evidence document,
- admin UI untuk melihat state,
- test user dengan role berbeda.

Dengan begitu developer tidak hanya menjalankan app, tetapi bisa mengeksplorasi behavior sistem.

Prinsip:

```text
Local developer platform yang baik memperpendek jarak dari code ke domain behavior.
```

---

## 24. Observability Lokal yang Cukup

Jangan membuat stack observability lokal terlalu berat sebagai default.

Default cukup:

- structured stdout log,
- health endpoint,
- metrics endpoint jika murah,
- `docker compose logs`,
- optional profile untuk collector/dashboard.

Contoh optional profile:

```yaml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    profiles: ["observe"]

  prometheus:
    image: prom/prometheus:latest
    profiles: ["observe"]

  grafana:
    image: grafana/grafana:latest
    profiles: ["observe"]
```

Run only when needed:

```bash
docker compose --profile observe up -d
```

Default environment harus ringan. Observability penuh bisa optional.

---

## 25. Image Pinning untuk Local Platform

Untuk local dev, banyak tim memakai `latest` karena mudah. Tapi `latest` bisa berubah tiba-tiba dan memecahkan onboarding.

Lebih baik:

```yaml
postgres:
  image: postgres:16.6
redis:
  image: redis:7.4
```

Untuk production atau CI critical path, digest pinning lebih kuat:

```yaml
postgres:
  image: postgres@sha256:...
```

Trade-off:

| Pinning | Kelebihan | Kekurangan |
|---|---|---|
| Major only, `postgres:16` | update patch otomatis | masih bisa berubah |
| Patch tag, `postgres:16.6` | lebih stabil | perlu update manual |
| Digest | immutable | readability rendah, update butuh tooling |

Untuk local developer platform, patch tag biasanya cukup, selama update dilakukan terencana.

---

## 26. Version Policy: Jangan Update Sembarangan

Dependency lokal juga dependency platform.

Tentukan policy:

```text
- Minor/patch dependency image update dilakukan mingguan/bulanan.
- Major version hanya lewat PR eksplisit.
- Compose file change harus diuji dengan ./dev reset --hard.
- Image update harus mencatat breaking changes.
- CI smoke test menjalankan compose baseline.
```

Tanpa policy, local platform akan membusuk atau berubah acak.

---

## 27. CI Smoke Test untuk Local Platform

Kalau local Compose penting, uji di CI.

Minimal:

```bash
cp .env.example .env
docker compose up -d --wait
docker compose ps
docker compose logs --tail=200
curl -f http://localhost:8080/actuator/health
docker compose down --volumes --remove-orphans
```

Kenapa?

Karena Compose file sering rusak tanpa sadar:

- image tag hilang,
- env var berubah,
- healthcheck salah,
- init script rusak,
- port berubah,
- Dockerfile target hilang,
- dependency startup lebih lama.

CI smoke test menjaga local platform sebagai artifact yang dirawat.

---

## 28. Documentation That Does Not Rot Immediately

Dokumentasi lokal harus pendek, executable, dan berorientasi masalah.

Struktur docs yang baik:

```markdown
# Local Development

## Prerequisites
- Docker Desktop/Engine version ...
- Java ... only if running app on host

## First Run
cp .env.example .env
./dev up

## Daily Commands
./dev up
./dev down
./dev logs api
./dev reset --hard

## Common Scenarios
- Run app from IDE
- Run app in container
- Enable Kafka profile
- Enable debug port
- Reset database
- Seed data

## Troubleshooting
- Port already in use
- Docker daemon not running
- Database unhealthy
- Certificate error
- Slow bind mount
- Wrong architecture
```

Dokumentasi buruk:

```text
Install Docker. Run the app.
```

Dokumentasi terlalu detail juga buruk jika tidak ada command yang bisa diverifikasi.

Rule:

```text
Every setup instruction should either be executable or explain a decision that cannot be encoded.
```

---

## 29. Handling Multiple Repositories

Banyak organisasi punya multi-repo.

Masalah:

- service A butuh service B,
- tiap repo punya Compose sendiri,
- network berbeda,
- port bentrok,
- versi dependency tidak sinkron,
- local integration sulit.

Strategi:

### 29.1 Per-Service Compose

Setiap repo punya Compose untuk dependency minimalnya.

Bagus untuk autonomy.

Kelemahan: cross-service integration manual.

### 29.2 Platform Compose Repo

Satu repo khusus menjalankan semua service dependency dan mock.

Bagus untuk sistem besar.

Kelemahan: bisa menjadi monolit lokal yang berat.

### 29.3 Shared External Network

Beberapa Compose project bergabung ke network eksternal.

```bash
docker network create company-local
```

```yaml
networks:
  company-local:
    external: true
```

Gunakan hanya jika memang perlu. Shared network membuat coupling antar repo lebih implicit.

### 29.4 Contract Mock First

Untuk banyak kasus, lebih baik service A memakai mock service B secara lokal, dan contract test memastikan kompatibilitas.

Jangan memaksa semua microservice jalan di satu laptop jika tidak diperlukan.

---

## 30. Handling Monorepo

Di monorepo, Compose bisa menjadi pusat topology lokal.

Contoh:

```text
repo/
  services/
    case-api/
    notification-worker/
    document-service/
  infra/
    compose.yaml
    postgres/init/
    wiremock/
  scripts/dev
```

Compose:

```yaml
services:
  case-api:
    build:
      context: .
      dockerfile: services/case-api/Dockerfile

  notification-worker:
    build:
      context: .
      dockerfile: services/notification-worker/Dockerfile

  postgres:
    image: postgres:16
```

Risiko monorepo Compose:

- semua service dibuild padahal hanya butuh satu,
- context terlalu besar,
- rebuild lambat,
- dependency graph sulit dibaca.

Gunakan profiles:

```yaml
case-api:
  profiles: ["case"]
notification-worker:
  profiles: ["notification"]
```

Dan optimalkan build context.

---

## 31. Anti-Pattern Local Docker Platform

### 31.1 “Just Run This Long Command”

Jika onboarding mengandalkan command 8 baris yang dicopy dari chat, platform belum stabil.

### 31.2 `.env` Dikirim Lewat Slack

Ini rawan secret leakage dan drift.

Gunakan `.env.example` plus secret retrieval procedure.

### 31.3 Semua Service Selalu Menyala

Membuat laptop lambat dan developer frustrasi.

Gunakan profiles.

### 31.4 Reset Tidak Ada

Tanpa reset, environment lokal menjadi snowflake.

### 31.5 Reset Terlalu Destructive

Reset yang diam-diam menghapus semua data tanpa warning akan membuat developer tidak percaya tool.

### 31.6 Compose File Menjadi Production Palsu

Local Compose mencoba meniru Kubernetes, service mesh, ingress, autoscaling, dan secret manager penuh.

Hasilnya berat dan rapuh.

### 31.7 Wrapper Script Menelan Error

Developer tidak bisa melihat command asli dan exit code.

### 31.8 Image `latest` di Semua Tempat

Onboarding bisa rusak tiba-tiba.

### 31.9 Tidak Ada Ownership

Local platform dianggap milik semua orang, akhirnya tidak dirawat siapa pun.

### 31.10 App Config Berbeda Total Antara Local dan Prod

Local environment harus boleh lebih ringan, tetapi kontrak config utama jangan berubah total.

---

## 32. Pattern: Local Platform untuk Java Service Tunggal

Contoh baseline.

### 32.1 `.env.example`

```dotenv
COMPOSE_PROJECT_NAME=myapp
APP_HOST_PORT=8080
DEBUG_HOST_PORT=5005
POSTGRES_HOST_PORT=5432
REDIS_HOST_PORT=6379
SPRING_PROFILES_ACTIVE=local
```

### 32.2 `compose.yaml`

```yaml
services:
  api:
    build:
      context: .
      target: runtime
    environment:
      SPRING_PROFILES_ACTIVE: ${SPRING_PROFILES_ACTIVE:-local}
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: app
      DB_USER: app
      DB_PASSWORD: app
      REDIS_HOST: redis
      REDIS_PORT: 6379
    ports:
      - "${APP_HOST_PORT:-8080}:8080"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "-", "http://localhost:8080/actuator/health"]
      interval: 10s
      timeout: 3s
      retries: 20
      start_period: 30s

  postgres:
    image: postgres:16.6
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    ports:
      - "${POSTGRES_HOST_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7.4
    ports:
      - "${REDIS_HOST_PORT:-6379}:6379"

  wiremock:
    image: wiremock/wiremock:3.9.1
    volumes:
      - ./docker/wiremock/mappings:/home/wiremock/mappings:ro
    ports:
      - "8089:8080"
    profiles: ["mock"]

  mailpit:
    image: axllent/mailpit:v1.20
    ports:
      - "8025:8025"
      - "1025:1025"
    profiles: ["mail"]

volumes:
  postgres-data:
```

Catatan:

- `api` memakai service name `postgres` dan `redis`, bukan localhost.
- host ports configurable.
- optional services memakai profiles.
- PostgreSQL punya healthcheck.
- named volume menyimpan data.

### 32.3 `scripts/dev`

```bash
#!/usr/bin/env bash
set -euo pipefail

cmd="${1:-help}"
shift || true

case "$cmd" in
  up)
    docker compose up -d --wait "$@"
    ;;
  down)
    docker compose down --remove-orphans
    ;;
  reset)
    docker compose down --remove-orphans
    docker compose up -d --wait
    ;;
  reset-hard)
    read -r -p "This removes local Docker volumes. Continue? [y/N] " answer
    case "$answer" in
      y|Y|yes|YES)
        docker compose down --remove-orphans --volumes
        docker compose up -d --wait
        ;;
      *)
        echo "Aborted"
        ;;
    esac
    ;;
  logs)
    docker compose logs -f --tail=200 "$@"
    ;;
  ps)
    docker compose ps
    ;;
  doctor)
    docker info >/dev/null
    docker compose version
    test -f .env || echo "WARN: .env not found. Copy .env.example to .env if needed."
    docker compose ps
    ;;
  help|*)
    cat <<'HELP'
Usage: ./scripts/dev <command>

Commands:
  up              Start local platform
  down            Stop containers, keep volumes
  reset           Recreate containers, keep volumes
  reset-hard      Remove volumes and recreate platform
  logs [service]  Tail logs
  ps              Show service status
  doctor          Run basic checks
HELP
    ;;
esac
```

---

## 33. Pattern: Host-Run Java App + Container Dependencies

Ini sering paling nyaman untuk daily development.

Compose hanya dependency:

```yaml
services:
  postgres:
    image: postgres:16.6
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
    ports:
      - "${POSTGRES_HOST_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7.4
    ports:
      - "${REDIS_HOST_PORT:-6379}:6379"

volumes:
  postgres-data:
```

App profile local:

```properties
spring.datasource.url=jdbc:postgresql://localhost:5432/app
spring.datasource.username=app
spring.datasource.password=app
spring.data.redis.host=localhost
spring.data.redis.port=6379
```

Run:

```bash
./dev up
./mvnw spring-boot:run
```

Kelebihan:

- IDE debug natural,
- no container rebuild,
- fast feedback.

Kekurangan:

- perlu Java host,
- app runtime tidak sama persis dengan container image.

Untuk banyak tim, ini adalah default terbaik. Containerized app bisa tetap diuji di CI atau profile khusus.

---

## 34. Pattern: Containerized Java App for Full Local Runtime

Gunakan bila ingin semua berjalan dalam Docker.

Dockerfile dev target:

```Dockerfile
FROM eclipse-temurin:21-jdk AS dev
WORKDIR /workspace
COPY mvnw pom.xml ./
COPY .mvn .mvn
RUN ./mvnw -q -DskipTests dependency:go-offline
COPY src src
CMD ["./mvnw", "spring-boot:run"]
```

Compose:

```yaml
services:
  api:
    build:
      context: .
      target: dev
    volumes:
      - ./src:/workspace/src
      - maven-cache:/root/.m2
    ports:
      - "8080:8080"
      - "5005:5005"
    environment:
      SPRING_PROFILES_ACTIVE: local
      JAVA_TOOL_OPTIONS: >-
        -agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:5005
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  maven-cache:
```

Perhatikan:

- Jangan gunakan root cache path jika final security policy non-root; untuk dev boleh, tapi harus sadar.
- Bind mount source saja jika ingin mengurangi filesystem overhead.
- Maven cache volume mempercepat dependency.
- Untuk Gradle, gunakan Gradle cache volume.

---

## 35. Local Platform Checklist

Gunakan checklist ini saat mereview local Docker setup tim.

### 35.1 First Run

- [ ] Ada instruksi first run maksimal beberapa command.
- [ ] `.env.example` tersedia.
- [ ] `.env` tidak dicommit.
- [ ] Docker/Compose minimum version disebutkan.
- [ ] Private registry login dijelaskan bila perlu.

### 35.2 Compose Topology

- [ ] Service name jelas.
- [ ] Dependency utama ada healthcheck.
- [ ] Optional services memakai profiles.
- [ ] Host ports configurable.
- [ ] Volumes dinamai jelas.
- [ ] Tidak memakai `latest` sembarangan.

### 35.3 Workflow

- [ ] Ada command `up`.
- [ ] Ada command `down`.
- [ ] Ada command `logs`.
- [ ] Ada command `reset`.
- [ ] Ada command destructive dengan konfirmasi.
- [ ] Ada command `doctor` atau troubleshooting guide.

### 35.4 Java App

- [ ] Mode host-run dan container-run jelas.
- [ ] Debug port optional.
- [ ] JVM option lokal tidak bocor ke production.
- [ ] DB host berbeda antara host app dan container app dipahami.
- [ ] Migration/seed workflow jelas.

### 35.5 Security

- [ ] Secret tidak dicommit.
- [ ] `.env` ignored.
- [ ] Certificate/truststore strategy jelas.
- [ ] Debug port tidak default production.
- [ ] Private registry credential tidak ada di file.

### 35.6 Operability

- [ ] Logs mudah diakses.
- [ ] Health endpoint mudah dicek.
- [ ] Reset state terdokumentasi.
- [ ] Common failure punya troubleshooting.
- [ ] CI smoke test menjalankan Compose baseline.

---

## 36. Troubleshooting Matrix

| Symptom | Kemungkinan Penyebab | Check | Fix |
|---|---|---|---|
| App tidak bisa connect DB | app di container pakai `localhost` | `docker compose exec api env` | gunakan `postgres` sebagai host |
| Port 8080 gagal bind | port dipakai app lain | `lsof -i :8080` | ubah `APP_HOST_PORT` |
| DB selalu unhealthy | password/db/user mismatch | `docker compose logs postgres` | samakan env dan healthcheck |
| Migration gagal setelah pull | volume lama punya schema incompatible | migration log, DB schema version | `reset-hard` atau migration repair |
| Image pull gagal | VPN/proxy/registry login | `docker pull image` | login/proxy/VPN |
| TLS error dari Java | CA tidak dipercaya JVM | stack trace PKIX | mount/import truststore |
| Lambat di macOS | bind mount heavy | Docker Desktop resource/file sharing | kurangi mount, gunakan cache volume |
| Kafka/mock optional tidak jalan | profile belum aktif | `docker compose ps` | run dengan `--profile` |
| Container app tidak update setelah edit | image belum rebuild atau sync tidak jalan | logs/build timestamp | rebuild/use watch/bind mount |
| Disk penuh | log/volume/image menumpuk | `docker system df` | prune terarah, log rotation |
| Wrong architecture | amd64/arm64 mismatch | `docker image inspect` | set platform/build multi-arch |

---

## 37. Decision Framework: Apa yang Harus Dicontainerize Lokal?

Gunakan pertanyaan ini.

### 37.1 Dependency

```text
Apakah dependency sulit diinstall konsisten di host?
```

Jika ya, containerize.

Database, broker, cache, object storage, mail sink, mock HTTP server: hampir selalu cocok.

### 37.2 Application

```text
Apakah menjalankan app di container mempercepat atau memperlambat inner loop?
```

Jika memperlambat terlalu banyak, jalankan app di host untuk daily dev dan gunakan containerized app untuk CI/smoke/integration.

### 37.3 Toolchain

```text
Apakah toolchain host sering menyebabkan drift?
```

Jika ya, pertimbangkan dev container atau build container.

### 37.4 External System

```text
Apakah external system mahal/rentan/rate-limited/side-effectful?
```

Jika ya, mock/stub lokal.

### 37.5 Observability

```text
Apakah observability stack diperlukan setiap hari?
```

Jika tidak, jadikan profile optional.

---

## 38. Governance: Siapa yang Merawat Local Platform?

Local platform butuh ownership.

Minimal:

```text
- Setiap perubahan Compose harus direview seperti code.
- Ada CODEOWNERS atau owner informal.
- Breaking changes diumumkan.
- Onboarding path dites berkala.
- Version update dilakukan terencana.
```

Tanpa ownership, local platform membusuk:

- image lama,
- docs basi,
- command rusak,
- workaround menumpuk,
- developer kembali ke setup manual.

Ownership bukan birokrasi. Ini menjaga workflow tim tetap murah.

---

## 39. Practical Blueprint untuk Tim Java

Untuk tim Java backend yang ingin memulai dengan sehat, blueprint minimal:

```text
1. Containerize dependencies dulu.
2. Jalankan app dari IDE/host untuk inner loop cepat.
3. Sediakan Dockerfile production-grade untuk image app.
4. Tambahkan Compose profile untuk menjalankan app di container.
5. Buat .env.example.
6. Buat ./dev wrapper kecil.
7. Tambahkan reset-hard dengan konfirmasi.
8. Tambahkan healthcheck untuk dependency penting.
9. Tambahkan mock external service.
10. Tambahkan CI smoke test untuk compose up.
```

Ini memberi keseimbangan bagus antara productivity dan consistency.

---

## 40. Example End-to-End Developer Journey

### Hari Pertama Developer Baru

```bash
git clone git@github.com:company/myapp.git
cd myapp
cp .env.example .env
./dev doctor
./dev up
./mvnw spring-boot:run
```

Buka:

```text
http://localhost:8080/actuator/health
```

Lihat logs dependency:

```bash
./dev logs postgres
```

Reset jika perlu:

```bash
./dev reset-hard
```

Aktifkan mock:

```bash
docker compose --profile mock up -d --wait
```

Jalankan test:

```bash
./dev test
```

### Saat Ada Masalah

```bash
./dev doctor
./dev ps
./dev logs api
./dev logs postgres
```

Jika DB stale:

```bash
./dev reset-hard
```

Jika port bentrok:

```dotenv
APP_HOST_PORT=18080
```

lalu:

```bash
./dev up
```

Journey ini pendek, eksplisit, dan dapat didiagnosis.

---

## 41. Koneksi ke Part Sebelumnya

Part ini mengikat banyak topik sebelumnya:

| Part Sebelumnya | Dipakai di Local Platform |
|---|---|
| Container lifecycle | `up`, `down`, `reset`, restart |
| Docker CLI fluency | `logs`, `ps`, `inspect`, `events` |
| Dockerfile | app image dan dev target |
| Build cache | inner loop build speed |
| Compose | topology lokal |
| Healthcheck | startup readiness |
| Config/secrets | `.env.example`, secret file |
| Security | debug port, credential, CA |
| Logging | `docker compose logs` |
| Debugging | `dev doctor`, service-specific diagnosis |
| Testing | Compose/Testcontainers boundary |
| Multi-platform | Apple Silicon vs CI/prod |
| Docker Desktop vs Linux | OS-specific caveat |

Local platform adalah tempat semua konsep itu bertemu dalam workflow nyata.

---

## 42. Ringkasan Mental Model

Docker untuk local developer platform bukan tujuan akhir. Ia adalah mekanisme untuk membuat workflow tim lebih eksplisit.

Model akhirnya:

```text
Dockerfile        = bagaimana app dipaketkan
Compose          = bagaimana sistem lokal disusun
.env.example     = konfigurasi apa yang wajib diketahui
profiles         = capability optional
volumes          = state lokal
healthchecks     = readiness contract
scripts/dev      = workflow contract
docs             = decision and troubleshooting contract
CI smoke test    = platform regression guard
```

Local platform yang baik bukan yang paling canggih. Local platform yang baik adalah yang:

1. cepat dipakai,
2. mudah di-reset,
3. mudah didiagnosis,
4. cukup mirip production pada kontrak yang penting,
5. tidak terlalu berat,
6. tidak menyembunyikan failure,
7. tidak membocorkan secret,
8. dirawat seperti bagian dari sistem.

---

## 43. Latihan Praktis

### Latihan 1 — Audit Local Workflow Saat Ini

Ambil satu service Java yang kamu punya. Jawab:

1. Berapa langkah onboarding dari clone sampai app health OK?
2. Dependency apa yang masih diinstall manual?
3. Env var apa yang tidak terdokumentasi?
4. Apakah ada reset command?
5. Apakah ada healthcheck dependency?
6. Apakah local Compose diuji di CI?
7. Apakah ada perbedaan config host-app dan container-app yang tidak jelas?

### Latihan 2 — Buat `.env.example`

Buat `.env.example` yang hanya berisi:

- local-safe default,
- komentar pendek,
- tidak ada secret production,
- host port configurable,
- profile-related config jika perlu.

### Latihan 3 — Tambahkan Profiles

Pisahkan service menjadi:

```text
default: api dependencies minimal
mock: external mock service
mail: email sink
observe: optional observability
debug: Java debug port
```

### Latihan 4 — Buat Reset Strategy

Implementasikan:

```bash
./dev reset
./dev reset-hard
```

Pastikan `reset-hard` meminta konfirmasi.

### Latihan 5 — CI Smoke Test

Tambahkan job CI yang menjalankan:

```bash
cp .env.example .env
docker compose up -d --wait
docker compose ps
curl -f http://localhost:8080/actuator/health
docker compose down --volumes --remove-orphans
```

Jika app terlalu berat, minimal jalankan dependency dan healthcheck dependency.

---

## 44. Kesalahan yang Harus Dihindari Setelah Membaca Part Ini

1. Menganggap Docker local setup cukup hanya dengan `compose.yaml`.
2. Tidak menyediakan reset.
3. Tidak membedakan app di host vs app di container.
4. Memakai `localhost` salah dari dalam container.
5. Menaruh secret di `.env.example`.
6. Menjalankan semua dependency berat by default.
7. Membuat wrapper script yang menelan error.
8. Tidak menguji local platform di CI.
9. Mengejar production clone palsu.
10. Tidak memberi ownership pada workflow lokal.

---

## 45. Penutup

Local developer platform adalah salah satu area di mana Docker memberi leverage terbesar bagi tim Java.

Bukan karena Docker membuat semua hal otomatis benar, tetapi karena Docker memaksa kita mendefinisikan hal-hal yang sebelumnya sering implicit:

- service apa yang dibutuhkan,
- versi dependency apa yang dipakai,
- port mana yang dibuka,
- state mana yang persistent,
- config apa yang wajib,
- bagaimana reset dilakukan,
- bagaimana health dicek,
- bagaimana developer mendiagnosis masalah.

Engineer yang kuat tidak hanya bisa membuat container jalan. Ia bisa merancang workflow agar seluruh tim bisa bergerak lebih cepat dengan failure yang lebih mudah dipahami.

Part berikutnya akan membahas production readiness tanpa Kubernetes: kapan Docker/Compose di VM cukup, bagaimana mengelola restart, systemd, backup, log rotation, update, rollback, dan batas jelas antara Docker single-host dengan orchestrator.

---

## Status Seri

Selesai sampai part ini:

```text
Part 000–027
```

Belum selesai. Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-028.md
Production Readiness Without Kubernetes: Docker on VM, Systemd, Restart, Backup
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-026.md">⬅️ Part 026 — Docker Desktop vs Linux Server: Development Convenience vs Runtime Reality</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-028.md">Part 028 — Production Readiness Without Kubernetes: Docker on VM, Systemd, Restart, Backup ➡️</a>
</div>
