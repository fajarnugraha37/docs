# learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-05.md

# Part 05 — Hands-on Local Lab: Docker, Management UI, CLI, Definitions

> Seri: RabbitMQ, RabbitMQ Stream, etc untuk Java Software Engineer  
> Fokus part ini: membangun local lab RabbitMQ yang repeatable, observable, dan cukup realistis untuk eksplorasi exchange, queue, binding, DLQ, quorum queue, stream, CLI, management UI, dan automation.

---

## 0. Posisi Part Ini Dalam Seri

Part sebelumnya membangun mental model:

- `part-00`: orientasi RabbitMQ modern.
- `part-01`: messaging semantics spesifik RabbitMQ.
- `part-02`: AMQP 0-9-1 sebagai bahasa internal RabbitMQ.
- `part-03`: exchange routing mastery.
- `part-04`: classic queue, quorum queue, dan stream.

Part ini mulai masuk ke praktik.

Namun praktik di sini **bukan sekadar menjalankan container lalu klik-klik Management UI**. Targetnya adalah membangun **lab environment yang bisa dipakai sepanjang seri** untuk menguji desain messaging secara sistematis.

Kita akan membuat local RabbitMQ yang bisa digunakan untuk:

1. Membuat exchange, queue, binding, dan stream.
2. Menguji direct/fanout/topic routing.
3. Menguji unroutable message.
4. Menguji dead-lettering.
5. Menguji quorum queue.
6. Mengaktifkan RabbitMQ Streams.
7. Menggunakan Management UI.
8. Menggunakan CLI.
9. Menggunakan HTTP API.
10. Menggunakan definitions file agar topology bisa direproduksi.
11. Menyiapkan fondasi untuk Java/Spring project di part berikutnya.

Prinsip utama part ini:

> Local lab yang baik bukan hanya “bisa jalan”, tetapi bisa diulang, dibersihkan, diinspeksi, dan dipakai untuk membuktikan asumsi desain.

---

## 1. Mental Model Local Lab

Saat belajar RabbitMQ, banyak engineer hanya menjalankan:

```bash
 docker run rabbitmq:management
```

Itu cukup untuk eksplorasi awal, tetapi kurang untuk belajar serius karena:

- topology tidak versioned;
- konfigurasi tidak eksplisit;
- plugin tidak jelas;
- data volume tidak terkontrol;
- credential hardcoded sembarangan;
- tidak ada struktur eksperimen;
- sulit diulang oleh orang lain;
- sulit dipakai di CI/integration test;
- tidak membangun kebiasaan production-grade.

Local lab yang kita buat harus punya sifat:

| Sifat | Makna |
|---|---|
| Repeatable | Bisa dihancurkan dan dibuat ulang dengan hasil sama |
| Observable | Bisa dilihat dari UI, CLI, HTTP API, dan logs |
| Scriptable | Bisa dipanggil dari shell/Makefile/CI |
| Versioned | Topology dan config disimpan sebagai file |
| Isolated | Tidak bercampur dengan broker lain |
| Extensible | Bisa ditambah stream, quorum, TLS, Prometheus nanti |
| Pedagogical | Memudahkan pembuktian konsep |

Kita ingin lab ini menjadi “wind tunnel” untuk messaging architecture.

Seperti wind tunnel untuk pesawat, local lab bukan production, tetapi dipakai untuk menguji:

- apakah routing bekerja;
- apakah retry masuk DLQ;
- apakah consumer ack benar;
- apakah publisher tahu saat message tidak ter-route;
- apakah queue type yang dipilih cocok;
- apakah throughput/latency berubah saat prefetch diubah;
- apakah topology bisa dibangun ulang dari definisi.

---

## 2. Requirement Tooling

Minimal tool yang dibutuhkan:

- Docker
- Docker Compose
- curl
- jq
- make, opsional tetapi sangat berguna
- Java 21, untuk part berikutnya
- Maven atau Gradle, untuk part Java/Spring

Untuk part ini, Java belum wajib dipakai. Kita fokus ke broker lab dahulu.

Cek versi dasar:

```bash
 docker --version
 docker compose version
 curl --version
 jq --version
```

Kalau `jq` belum ada, install sesuai OS:

```bash
 # macOS
 brew install jq

 # Ubuntu/Debian
 sudo apt-get update && sudo apt-get install -y jq
```

---

## 3. Struktur Direktori Lab

Buat struktur seperti ini:

```text
rabbitmq-lab/
  docker-compose.yml
  Makefile
  rabbitmq/
    enabled_plugins
    rabbitmq.conf
    definitions.json
  scripts/
    wait-for-rabbitmq.sh
    api.sh
    publish-amqp.sh
    inspect.sh
  notes/
    experiments.md
```

Penjelasan:

| Path | Fungsi |
|---|---|
| `docker-compose.yml` | Menjalankan RabbitMQ dan service pendukung |
| `Makefile` | Shortcut operasional |
| `rabbitmq/enabled_plugins` | Plugin RabbitMQ yang aktif saat startup |
| `rabbitmq/rabbitmq.conf` | Konfigurasi broker |
| `rabbitmq/definitions.json` | User, vhost, exchange, queue, binding awal |
| `scripts/wait-for-rabbitmq.sh` | Menunggu broker siap |
| `scripts/api.sh` | Helper HTTP API |
| `scripts/publish-amqp.sh` | Helper publish sederhana |
| `scripts/inspect.sh` | Helper inspeksi topology |
| `notes/experiments.md` | Catatan eksperimen |

Kenapa topology dimasukkan ke file?

Karena dalam sistem serius, messaging topology adalah bagian dari architecture contract. Exchange, queue, binding, policies, DLQ, dan vhost bukan konfigurasi “klik manual”.

Topology harus bisa:

- direview;
- diuji;
- diulang;
- dipromosikan antar environment;
- dihapus dengan aman;
- didokumentasikan;
- dibandingkan antar versi.

---

## 4. Docker Compose Dasar

Buat file `docker-compose.yml`:

```yaml
services:
  rabbitmq:
    image: rabbitmq:4-management
    container_name: rabbitmq-lab
    hostname: rabbitmq-lab
    ports:
      - "5672:5672"      # AMQP 0-9-1
      - "15672:15672"    # Management UI / HTTP API
      - "5552:5552"      # RabbitMQ Stream Protocol
    environment:
      RABBITMQ_DEFAULT_USER: lab
      RABBITMQ_DEFAULT_PASS: lab
      RABBITMQ_DEFAULT_VHOST: lab
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq
      - ./rabbitmq/rabbitmq.conf:/etc/rabbitmq/rabbitmq.conf:ro
      - ./rabbitmq/enabled_plugins:/etc/rabbitmq/enabled_plugins:ro
      - ./rabbitmq/definitions.json:/etc/rabbitmq/definitions.json:ro
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 20s

volumes:
  rabbitmq_data:
```

Catatan penting:

- Port `5672` adalah AMQP 0-9-1.
- Port `15672` adalah Management UI dan HTTP API.
- Port `5552` adalah RabbitMQ Stream Protocol.
- User/password lab hanya untuk lokal, bukan production.
- Volume `rabbitmq_data` menyimpan broker data.
- `definitions.json` akan di-load oleh management plugin saat startup.

Kenapa pakai image `rabbitmq:4-management`?

Karena seri ini memakai RabbitMQ modern 4.x sebagai baseline. Management plugin aktif di image `management`, sehingga UI dan HTTP API tersedia tanpa langkah manual.

---

## 5. Enabled Plugins

Buat file `rabbitmq/enabled_plugins`:

```erlang
[
  rabbitmq_management,
  rabbitmq_prometheus,
  rabbitmq_stream,
  rabbitmq_stream_management,
  rabbitmq_shovel,
  rabbitmq_shovel_management,
  rabbitmq_federation,
  rabbitmq_federation_management,
  rabbitmq_consistent_hash_exchange
].
```

Plugin ini sengaja agak lengkap untuk lab:

| Plugin | Fungsi |
|---|---|
| `rabbitmq_management` | Management UI dan HTTP API |
| `rabbitmq_prometheus` | Metrics endpoint untuk observability |
| `rabbitmq_stream` | RabbitMQ Streams |
| `rabbitmq_stream_management` | Management UI support untuk stream |
| `rabbitmq_shovel` | Message movement antar broker/topology |
| `rabbitmq_shovel_management` | UI untuk shovel |
| `rabbitmq_federation` | Federation antar broker |
| `rabbitmq_federation_management` | UI federation |
| `rabbitmq_consistent_hash_exchange` | Exchange untuk distribusi berbasis hash |

Apakah semua plugin ini harus aktif di production? Tidak.

Di production, aktifkan plugin sesuai kebutuhan. Untuk lab, plugin ini membantu eksplorasi part-part berikutnya.

---

## 6. RabbitMQ Configuration

Buat file `rabbitmq/rabbitmq.conf`:

```ini
# Management UI and HTTP API
management.tcp.port = 15672
management.load_definitions = /etc/rabbitmq/definitions.json

# Stream protocol listener
stream.listeners.tcp.default = 5552

# Local lab resource guardrails
vm_memory_high_watermark.relative = 0.6
disk_free_limit.relative = 1.0

# Useful for local troubleshooting
log.console = true
log.console.level = info

# Prometheus
prometheus.tcp.port = 15692
```

Penjelasan:

| Config | Makna |
|---|---|
| `management.load_definitions` | Load topology/user/vhost dari file |
| `stream.listeners.tcp.default` | Membuka listener stream protocol |
| `vm_memory_high_watermark.relative` | Broker mulai flow control saat memory melewati threshold |
| `disk_free_limit.relative` | Proteksi disk free limit |
| `prometheus.tcp.port` | Metrics endpoint |

RabbitMQ bukan sekadar program yang “jalan”. Ia punya guardrails untuk memory dan disk. Bahkan di local lab, penting untuk menyadari bahwa broker bisa memblokir publisher saat resource pressure.

---

## 7. Definitions File: Topology sebagai Artifact

Buat file `rabbitmq/definitions.json`.

Kita mulai dengan topology awal yang mencakup:

- vhost `lab`;
- user `lab`;
- permission;
- exchange direct, fanout, topic, dead-letter, alternate;
- queues untuk command, event subscription, audit, retry, DLQ;
- quorum queue;
- stream queue;
- bindings.

```json
{
  "users": [
    {
      "name": "lab",
      "password_hash": "",
      "hashing_algorithm": "rabbit_password_hashing_sha256",
      "tags": ["administrator"]
    }
  ],
  "vhosts": [
    {
      "name": "lab"
    }
  ],
  "permissions": [
    {
      "user": "lab",
      "vhost": "lab",
      "configure": ".*",
      "write": ".*",
      "read": ".*"
    }
  ],
  "parameters": [],
  "policies": [
    {
      "vhost": "lab",
      "name": "quorum-default-delivery-limit",
      "pattern": "^qq\\.",
      "apply-to": "queues",
      "definition": {
        "delivery-limit": 5
      },
      "priority": 0
    },
    {
      "vhost": "lab",
      "name": "stream-retention-default",
      "pattern": "^stream\\.",
      "apply-to": "queues",
      "definition": {
        "max-age": "1D"
      },
      "priority": 0
    }
  ],
  "queues": [
    {
      "name": "q.case.command.evaluate-risk",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-dead-letter-exchange": "x.case.dlx",
        "x-dead-letter-routing-key": "case.command.evaluate-risk.dead"
      }
    },
    {
      "name": "q.case.event.notification-service",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-dead-letter-exchange": "x.case.dlx",
        "x-dead-letter-routing-key": "case.event.notification-service.dead"
      }
    },
    {
      "name": "q.case.event.audit-projection",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-dead-letter-exchange": "x.case.dlx",
        "x-dead-letter-routing-key": "case.event.audit-projection.dead"
      }
    },
    {
      "name": "q.case.unroutable",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {}
    },
    {
      "name": "q.case.dlq",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {}
    },
    {
      "name": "q.case.retry.10s",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-message-ttl": 10000,
        "x-dead-letter-exchange": "x.case.command",
        "x-dead-letter-routing-key": "case.command.evaluate-risk"
      }
    },
    {
      "name": "qq.case.command.generate-notice",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-queue-type": "quorum",
        "x-dead-letter-exchange": "x.case.dlx",
        "x-dead-letter-routing-key": "case.command.generate-notice.dead"
      }
    },
    {
      "name": "stream.case.audit-log",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-queue-type": "stream",
        "x-max-age": "1D"
      }
    }
  ],
  "exchanges": [
    {
      "name": "x.case.command",
      "vhost": "lab",
      "type": "direct",
      "durable": true,
      "auto_delete": false,
      "internal": false,
      "arguments": {
        "alternate-exchange": "x.case.unroutable"
      }
    },
    {
      "name": "x.case.event",
      "vhost": "lab",
      "type": "topic",
      "durable": true,
      "auto_delete": false,
      "internal": false,
      "arguments": {
        "alternate-exchange": "x.case.unroutable"
      }
    },
    {
      "name": "x.case.broadcast",
      "vhost": "lab",
      "type": "fanout",
      "durable": true,
      "auto_delete": false,
      "internal": false,
      "arguments": {}
    },
    {
      "name": "x.case.dlx",
      "vhost": "lab",
      "type": "topic",
      "durable": true,
      "auto_delete": false,
      "internal": false,
      "arguments": {}
    },
    {
      "name": "x.case.unroutable",
      "vhost": "lab",
      "type": "fanout",
      "durable": true,
      "auto_delete": false,
      "internal": false,
      "arguments": {}
    }
  ],
  "bindings": [
    {
      "source": "x.case.command",
      "vhost": "lab",
      "destination": "q.case.command.evaluate-risk",
      "destination_type": "queue",
      "routing_key": "case.command.evaluate-risk",
      "arguments": {}
    },
    {
      "source": "x.case.command",
      "vhost": "lab",
      "destination": "qq.case.command.generate-notice",
      "destination_type": "queue",
      "routing_key": "case.command.generate-notice",
      "arguments": {}
    },
    {
      "source": "x.case.event",
      "vhost": "lab",
      "destination": "q.case.event.notification-service",
      "destination_type": "queue",
      "routing_key": "case.event.*.notification-required",
      "arguments": {}
    },
    {
      "source": "x.case.event",
      "vhost": "lab",
      "destination": "q.case.event.audit-projection",
      "destination_type": "queue",
      "routing_key": "case.event.#",
      "arguments": {}
    },
    {
      "source": "x.case.event",
      "vhost": "lab",
      "destination": "stream.case.audit-log",
      "destination_type": "queue",
      "routing_key": "case.event.#",
      "arguments": {}
    },
    {
      "source": "x.case.unroutable",
      "vhost": "lab",
      "destination": "q.case.unroutable",
      "destination_type": "queue",
      "routing_key": "",
      "arguments": {}
    },
    {
      "source": "x.case.dlx",
      "vhost": "lab",
      "destination": "q.case.dlq",
      "destination_type": "queue",
      "routing_key": "#",
      "arguments": {}
    }
  ]
}
```

Ada satu masalah: `password_hash` kosong tidak ideal untuk definitions import penuh.

Untuk lab sederhana, lebih praktis memakai `RABBITMQ_DEFAULT_USER` dan `RABBITMQ_DEFAULT_PASS` dari environment, lalu definitions hanya untuk topology. Namun beberapa setup definitions bisa bentrok dengan default user.

Agar tidak bingung, ada dua pendekatan.

### Pendekatan A — Simple Lab

Biarkan user dibuat oleh environment variable:

```yaml
environment:
  RABBITMQ_DEFAULT_USER: lab
  RABBITMQ_DEFAULT_PASS: lab
  RABBITMQ_DEFAULT_VHOST: lab
```

Lalu definitions file tidak perlu mendefinisikan `users`, `vhosts`, dan `permissions`.

Ini paling nyaman untuk belajar.

### Pendekatan B — Full Definitions

Generate password hash dengan tool RabbitMQ atau export definitions dari UI setelah membuat user.

Untuk seri ini, gunakan pendekatan A agar tidak terdistraksi oleh password hashing.

Maka versi `definitions.json` yang lebih aman untuk lab adalah:

```json
{
  "policies": [
    {
      "vhost": "lab",
      "name": "quorum-default-delivery-limit",
      "pattern": "^qq\\.",
      "apply-to": "queues",
      "definition": {
        "delivery-limit": 5
      },
      "priority": 0
    },
    {
      "vhost": "lab",
      "name": "stream-retention-default",
      "pattern": "^stream\\.",
      "apply-to": "queues",
      "definition": {
        "max-age": "1D"
      },
      "priority": 0
    }
  ],
  "queues": [
    {
      "name": "q.case.command.evaluate-risk",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-dead-letter-exchange": "x.case.dlx",
        "x-dead-letter-routing-key": "case.command.evaluate-risk.dead"
      }
    },
    {
      "name": "q.case.event.notification-service",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-dead-letter-exchange": "x.case.dlx",
        "x-dead-letter-routing-key": "case.event.notification-service.dead"
      }
    },
    {
      "name": "q.case.event.audit-projection",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-dead-letter-exchange": "x.case.dlx",
        "x-dead-letter-routing-key": "case.event.audit-projection.dead"
      }
    },
    {
      "name": "q.case.unroutable",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {}
    },
    {
      "name": "q.case.dlq",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {}
    },
    {
      "name": "q.case.retry.10s",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-message-ttl": 10000,
        "x-dead-letter-exchange": "x.case.command",
        "x-dead-letter-routing-key": "case.command.evaluate-risk"
      }
    },
    {
      "name": "qq.case.command.generate-notice",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-queue-type": "quorum",
        "x-dead-letter-exchange": "x.case.dlx",
        "x-dead-letter-routing-key": "case.command.generate-notice.dead"
      }
    },
    {
      "name": "stream.case.audit-log",
      "vhost": "lab",
      "durable": true,
      "auto_delete": false,
      "arguments": {
        "x-queue-type": "stream",
        "x-max-age": "1D"
      }
    }
  ],
  "exchanges": [
    {
      "name": "x.case.command",
      "vhost": "lab",
      "type": "direct",
      "durable": true,
      "auto_delete": false,
      "internal": false,
      "arguments": {
        "alternate-exchange": "x.case.unroutable"
      }
    },
    {
      "name": "x.case.event",
      "vhost": "lab",
      "type": "topic",
      "durable": true,
      "auto_delete": false,
      "internal": false,
      "arguments": {
        "alternate-exchange": "x.case.unroutable"
      }
    },
    {
      "name": "x.case.broadcast",
      "vhost": "lab",
      "type": "fanout",
      "durable": true,
      "auto_delete": false,
      "internal": false,
      "arguments": {}
    },
    {
      "name": "x.case.dlx",
      "vhost": "lab",
      "type": "topic",
      "durable": true,
      "auto_delete": false,
      "internal": false,
      "arguments": {}
    },
    {
      "name": "x.case.unroutable",
      "vhost": "lab",
      "type": "fanout",
      "durable": true,
      "auto_delete": false,
      "internal": false,
      "arguments": {}
    }
  ],
  "bindings": [
    {
      "source": "x.case.command",
      "vhost": "lab",
      "destination": "q.case.command.evaluate-risk",
      "destination_type": "queue",
      "routing_key": "case.command.evaluate-risk",
      "arguments": {}
    },
    {
      "source": "x.case.command",
      "vhost": "lab",
      "destination": "qq.case.command.generate-notice",
      "destination_type": "queue",
      "routing_key": "case.command.generate-notice",
      "arguments": {}
    },
    {
      "source": "x.case.event",
      "vhost": "lab",
      "destination": "q.case.event.notification-service",
      "destination_type": "queue",
      "routing_key": "case.event.*.notification-required",
      "arguments": {}
    },
    {
      "source": "x.case.event",
      "vhost": "lab",
      "destination": "q.case.event.audit-projection",
      "destination_type": "queue",
      "routing_key": "case.event.#",
      "arguments": {}
    },
    {
      "source": "x.case.event",
      "vhost": "lab",
      "destination": "stream.case.audit-log",
      "destination_type": "queue",
      "routing_key": "case.event.#",
      "arguments": {}
    },
    {
      "source": "x.case.unroutable",
      "vhost": "lab",
      "destination": "q.case.unroutable",
      "destination_type": "queue",
      "routing_key": "",
      "arguments": {}
    },
    {
      "source": "x.case.dlx",
      "vhost": "lab",
      "destination": "q.case.dlq",
      "destination_type": "queue",
      "routing_key": "#",
      "arguments": {}
    }
  ]
}
```

---

## 8. Menjalankan Lab

Dari root folder:

```bash
docker compose up -d
```

Cek container:

```bash
docker compose ps
```

Lihat log:

```bash
docker compose logs -f rabbitmq
```

Buka Management UI:

```text
http://localhost:15672
```

Login:

```text
username: lab
password: lab
```

Pilih vhost `lab`.

Cek endpoint HTTP API:

```bash
curl -u lab:lab http://localhost:15672/api/overview | jq
```

Cek Prometheus metrics:

```bash
curl http://localhost:15692/metrics | head
```

Cek stream listener dari dalam container:

```bash
docker exec rabbitmq-lab rabbitmq-diagnostics listeners
```

---

## 9. Makefile untuk Operasi Harian

Buat `Makefile`:

```makefile
.PHONY: up down restart logs ps clean nuke ui overview queues exchanges bindings health definitions

up:
	docker compose up -d

down:
	docker compose down

restart:
	docker compose restart rabbitmq

logs:
	docker compose logs -f rabbitmq

ps:
	docker compose ps

clean:
	docker compose down

nuke:
	docker compose down -v

ui:
	@echo "Open: http://localhost:15672"
	@echo "User: lab"
	@echo "Pass: lab"

overview:
	curl -s -u lab:lab http://localhost:15672/api/overview | jq

health:
	docker exec rabbitmq-lab rabbitmq-diagnostics -q ping

definitions:
	curl -s -u lab:lab http://localhost:15672/api/definitions | jq

queues:
	curl -s -u lab:lab http://localhost:15672/api/queues/lab | jq '.[] | {name, type, durable, messages, messages_ready, messages_unacknowledged, consumers, arguments}'

exchanges:
	curl -s -u lab:lab http://localhost:15672/api/exchanges/lab | jq '.[] | {name, type, durable, internal, arguments}'

bindings:
	curl -s -u lab:lab http://localhost:15672/api/bindings/lab | jq '.[] | {source, destination, destination_type, routing_key}'
```

Sekarang operasi dasar:

```bash
make up
make health
make overview
make queues
make exchanges
make bindings
make logs
make nuke
```

Kenapa `nuke` penting?

Karena saat belajar RabbitMQ, kamu akan sering membuat topology salah. Banyak properti queue/exchange bersifat immutable. Misalnya, queue yang sudah dibuat sebagai classic tidak bisa begitu saja diubah menjadi quorum dengan declare ulang nama sama.

Solusi local lab:

```bash
make nuke
make up
```

Ini menghapus volume dan membuat broker fresh dari definitions file.

---

## 10. Management UI Tour

Management UI bukan hanya dashboard visual. Ini alat debugging topology.

Halaman utama yang penting:

### Overview

Melihat:

- message rates;
- global counts;
- node health;
- listeners;
- enabled plugins;
- resource alarms.

Gunakan untuk menjawab:

- broker hidup atau tidak?
- ada alarm memory/disk?
- message rate normal?
- plugin stream aktif?

### Connections

Melihat koneksi client.

Gunakan untuk menjawab:

- service mana membuka terlalu banyak connection?
- connection blocked atau tidak?
- client pakai user/vhost mana?
- heartbeat berjalan?

### Channels

Melihat channel per connection.

Gunakan untuk menjawab:

- apakah aplikasi membuat channel terlalu banyak?
- apakah channel stuck?
- prefetch berapa?
- unacked di channel mana?

### Exchanges

Melihat exchange, type, arguments, binding.

Gunakan untuk menjawab:

- exchange exists?
- type benar?
- ada alternate exchange?
- bindings sesuai routing design?

### Queues and Streams

Melihat:

- queue type;
- ready messages;
- unacked messages;
- consumer count;
- incoming/outgoing rate;
- arguments;
- DLX;
- TTL;
- leader/node placement.

Gunakan untuk menjawab:

- message menumpuk di mana?
- consumer ada atau tidak?
- message stuck ready atau unacked?
- queue type benar?
- DLX terpasang?

### Admin

Melihat:

- users;
- vhosts;
- permissions;
- policies;
- limits.

Gunakan untuk menjawab:

- apakah user punya permission benar?
- policy apply ke queue yang benar?
- apakah vhost terisolasi?

---

## 11. CLI: `rabbitmqctl`, `rabbitmq-diagnostics`, dan `rabbitmq-plugins`

Masuk ke container:

```bash
docker exec -it rabbitmq-lab bash
```

Cek status node:

```bash
rabbitmqctl status
```

Cek vhost:

```bash
rabbitmqctl list_vhosts
```

Cek users:

```bash
rabbitmqctl list_users
```

Cek permissions:

```bash
rabbitmqctl list_permissions -p lab
```

Cek queues:

```bash
rabbitmqctl list_queues -p lab name type durable messages_ready messages_unacknowledged consumers arguments
```

Cek exchanges:

```bash
rabbitmqctl list_exchanges -p lab name type durable auto_delete internal arguments
```

Cek bindings:

```bash
rabbitmqctl list_bindings -p lab source_name source_kind destination_name destination_kind routing_key arguments
```

Cek listeners:

```bash
rabbitmq-diagnostics listeners
```

Cek alarms:

```bash
rabbitmq-diagnostics alarms
```

Cek enabled plugins:

```bash
rabbitmq-plugins list --enabled
```

Mental model CLI:

| Tool | Fokus |
|---|---|
| `rabbitmqctl` | Administrasi broker dan metadata |
| `rabbitmq-diagnostics` | Health, runtime, troubleshooting |
| `rabbitmq-plugins` | Plugin lifecycle |

Dalam production, UI sering dibatasi. CLI dan HTTP API lebih cocok untuk automation, incident response, dan runbook.

---

## 12. HTTP API Helper

Buat `scripts/api.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

RABBIT_URL="${RABBIT_URL:-http://localhost:15672}"
RABBIT_USER="${RABBIT_USER:-lab}"
RABBIT_PASS="${RABBIT_PASS:-lab}"

curl -s -u "$RABBIT_USER:$RABBIT_PASS" "$RABBIT_URL$1" | jq
```

Buat executable:

```bash
chmod +x scripts/api.sh
```

Contoh:

```bash
./scripts/api.sh /api/overview
./scripts/api.sh /api/queues/lab
./scripts/api.sh /api/exchanges/lab
./scripts/api.sh /api/bindings/lab
```

Gunakan helper ini untuk membiasakan melihat broker sebagai API, bukan hanya UI.

---

## 13. Publish Message Lewat HTTP API

Management HTTP API bisa publish message. Ini berguna untuk eksperimen tanpa menulis Java.

### Publish Command ke Direct Exchange

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/exchanges/lab/x.case.command/publish \
  -d '{
    "properties": {
      "content_type": "application/json",
      "message_id": "msg-001",
      "correlation_id": "corr-001",
      "delivery_mode": 2,
      "headers": {
        "schema_version": "1.0"
      }
    },
    "routing_key": "case.command.evaluate-risk",
    "payload": "{\"caseId\":\"CASE-001\",\"reason\":\"initial-risk-screening\"}",
    "payload_encoding": "string"
  }' | jq
```

Expected response:

```json
{
  "routed": true
}
```

Cek queue:

```bash
make queues
```

Queue `q.case.command.evaluate-risk` harus memiliki `messages_ready = 1`.

### Publish Event ke Topic Exchange

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/exchanges/lab/x.case.event/publish \
  -d '{
    "properties": {
      "content_type": "application/json",
      "message_id": "evt-001",
      "correlation_id": "corr-001",
      "delivery_mode": 2,
      "headers": {
        "schema_version": "1.0",
        "event_type": "CaseOpened"
      }
    },
    "routing_key": "case.event.opened.notification-required",
    "payload": "{\"caseId\":\"CASE-001\",\"openedBy\":\"system\"}",
    "payload_encoding": "string"
  }' | jq
```

Message ini harus route ke:

- `q.case.event.notification-service`, karena binding `case.event.*.notification-required` cocok;
- `q.case.event.audit-projection`, karena binding `case.event.#` cocok;
- `stream.case.audit-log`, karena binding `case.event.#` cocok.

Ini membuktikan perbedaan penting RabbitMQ dari Kafka:

> Satu publish ke exchange dapat menghasilkan banyak copy ke queue berbeda berdasarkan binding, bukan berdasarkan consumer group saja.

---

## 14. Mengambil Message dari Queue via HTTP API

Untuk debugging, Management API bisa mengambil message.

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/queues/lab/q.case.command.evaluate-risk/get \
  -d '{
    "count": 1,
    "ackmode": "ack_requeue_false",
    "encoding": "auto",
    "truncate": 50000
  }' | jq
```

`ackmode` penting:

| Ack mode | Efek |
|---|---|
| `ack_requeue_false` | Ambil dan hapus message |
| `ack_requeue_true` | Ambil lalu requeue |
| `reject_requeue_false` | Reject tanpa requeue |
| `reject_requeue_true` | Reject dan requeue |

Jangan pakai HTTP get sebagai consumer production.

Ini hanya untuk debugging. Consumer production harus menggunakan AMQP client atau stream client.

---

## 15. Eksperimen 1 — Direct Routing

Tujuan:

Membuktikan direct exchange route berdasarkan exact routing key.

Publish:

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/exchanges/lab/x.case.command/publish \
  -d '{
    "properties": {},
    "routing_key": "case.command.evaluate-risk",
    "payload": "{\"caseId\":\"CASE-DIRECT-001\"}",
    "payload_encoding": "string"
  }' | jq
```

Cek:

```bash
make queues
```

Expected:

- `q.case.command.evaluate-risk` bertambah.
- `qq.case.command.generate-notice` tidak bertambah.

Sekarang publish routing key lain:

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/exchanges/lab/x.case.command/publish \
  -d '{
    "properties": {},
    "routing_key": "case.command.generate-notice",
    "payload": "{\"caseId\":\"CASE-DIRECT-002\"}",
    "payload_encoding": "string"
  }' | jq
```

Expected:

- `qq.case.command.generate-notice` bertambah.
- `q.case.command.evaluate-risk` tidak bertambah.

Invariant:

> Direct exchange adalah exact routing-key match.

---

## 16. Eksperimen 2 — Topic Routing

Tujuan:

Membuktikan topic wildcard.

Binding:

```text
q.case.event.notification-service -> case.event.*.notification-required
q.case.event.audit-projection     -> case.event.#
stream.case.audit-log             -> case.event.#
```

Publish:

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/exchanges/lab/x.case.event/publish \
  -d '{
    "properties": {},
    "routing_key": "case.event.opened.notification-required",
    "payload": "{\"caseId\":\"CASE-TOPIC-001\"}",
    "payload_encoding": "string"
  }' | jq
```

Expected:

- notification-service menerima.
- audit-projection menerima.
- stream audit-log menerima.

Publish event tanpa notification:

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/exchanges/lab/x.case.event/publish \
  -d '{
    "properties": {},
    "routing_key": "case.event.closed",
    "payload": "{\"caseId\":\"CASE-TOPIC-002\"}",
    "payload_encoding": "string"
  }' | jq
```

Expected:

- notification-service tidak menerima.
- audit-projection menerima.
- stream audit-log menerima.

Invariant:

> Topic exchange membuat broker menjadi semantic routing fabric.

Namun jangan berlebihan. Routing key bukan tempat menyimpan seluruh business payload.

---

## 17. Eksperimen 3 — Alternate Exchange untuk Unroutable Message

Exchange `x.case.command` dan `x.case.event` punya argument:

```json
{
  "alternate-exchange": "x.case.unroutable"
}
```

Artinya, kalau message tidak cocok binding mana pun, RabbitMQ akan route ke alternate exchange.

Publish command tidak dikenal:

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/exchanges/lab/x.case.command/publish \
  -d '{
    "properties": {},
    "routing_key": "case.command.unknown",
    "payload": "{\"caseId\":\"CASE-UNROUTABLE-001\"}",
    "payload_encoding": "string"
  }' | jq
```

Cek queue `q.case.unroutable`.

Expected:

- `q.case.unroutable` bertambah.
- response publish kemungkinan tetap `routed: true` karena message berhasil masuk alternate exchange.

Kenapa ini penting?

Tanpa alternate exchange atau mandatory publish handling, publisher bisa mengira message sudah “berhasil”, padahal tidak ada queue menerima.

Desain produksi harus punya jawaban untuk pertanyaan:

> Apa yang terjadi kalau routing key salah?

Jawaban buruk:

> Tidak tahu.

Jawaban baik:

> Publisher detect returned message, atau broker route ke alternate exchange untuk forensics.

---

## 18. Eksperimen 4 — Dead Letter Queue

Dead-lettering terjadi saat message dikeluarkan dari queue karena kondisi tertentu, misalnya:

- rejected/nacked dengan requeue false;
- TTL expired;
- queue length limit exceeded;
- quorum queue delivery-limit exceeded.

Untuk simulasi manual, ambil message dengan `reject_requeue_false` dari queue yang punya DLX.

Pertama publish ke queue command:

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/exchanges/lab/x.case.command/publish \
  -d '{
    "properties": {},
    "routing_key": "case.command.evaluate-risk",
    "payload": "{\"caseId\":\"CASE-DLQ-001\"}",
    "payload_encoding": "string"
  }' | jq
```

Lalu reject tanpa requeue:

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/queues/lab/q.case.command.evaluate-risk/get \
  -d '{
    "count": 1,
    "ackmode": "reject_requeue_false",
    "encoding": "auto",
    "truncate": 50000
  }' | jq
```

Cek `q.case.dlq`:

```bash
make queues
```

Expected:

- `q.case.dlq` bertambah.

Message akan berisi header dead-letter seperti `x-death` yang membantu forensics.

Invariant:

> DLQ bukan tempat sampah. DLQ adalah failure evidence store.

Dalam sistem regulasi, DLQ harus diperlakukan sebagai antrian investigasi operasional, bukan dibiarkan menumpuk tanpa ownership.

---

## 19. Eksperimen 5 — TTL Retry Queue

Queue `q.case.retry.10s` memiliki:

```json
{
  "x-message-ttl": 10000,
  "x-dead-letter-exchange": "x.case.command",
  "x-dead-letter-routing-key": "case.command.evaluate-risk"
}
```

Artinya:

1. Message masuk retry queue.
2. Menunggu 10 detik.
3. TTL expire.
4. Message dead-letter ke `x.case.command`.
5. Routing key diarahkan ke `case.command.evaluate-risk`.
6. Message masuk kembali ke queue command utama.

Publish langsung ke retry queue via default exchange:

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/exchanges/lab/amq.default/publish \
  -d '{
    "properties": {},
    "routing_key": "q.case.retry.10s",
    "payload": "{\"caseId\":\"CASE-RETRY-001\"}",
    "payload_encoding": "string"
  }' | jq
```

Cek segera:

```bash
make queues
```

Expected:

- `q.case.retry.10s` bertambah.

Tunggu 10-15 detik, cek lagi:

```bash
make queues
```

Expected:

- `q.case.retry.10s` turun.
- `q.case.command.evaluate-risk` bertambah.

Invariant:

> TTL retry queue adalah delay mechanism berbasis broker topology, bukan sleep di consumer.

Namun part berikutnya akan menunjukkan risiko retry topology sederhana:

- retry count harus dikontrol;
- poison message tidak boleh infinite loop;
- backoff harus masuk akal;
- DLQ harus punya owner;
- per-message TTL bisa menyebabkan head-of-line blocking pada beberapa kondisi.

---

## 20. Eksperimen 6 — Quorum Queue

Queue `qq.case.command.generate-notice` dibuat dengan:

```json
{
  "x-queue-type": "quorum"
}
```

Cek via API:

```bash
curl -s -u lab:lab http://localhost:15672/api/queues/lab/qq.case.command.generate-notice | jq '{name, type, durable, arguments}'
```

Publish:

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/exchanges/lab/x.case.command/publish \
  -d '{
    "properties": {"delivery_mode": 2},
    "routing_key": "case.command.generate-notice",
    "payload": "{\"caseId\":\"CASE-QQ-001\"}",
    "payload_encoding": "string"
  }' | jq
```

Cek queue:

```bash
curl -s -u lab:lab http://localhost:15672/api/queues/lab/qq.case.command.generate-notice | jq
```

Dalam single-node local lab, quorum queue tetap berjalan tetapi tidak menunjukkan value replikasi penuh. Value sebenarnya muncul dalam cluster multi-node.

Namun local lab tetap berguna untuk belajar:

- deklarasi quorum queue;
- policy delivery-limit;
- DLQ;
- behavior berbeda dari classic queue;
- compatibility dengan application topology.

Invariant:

> Quorum queue adalah pilihan default yang lebih defensible untuk durable work queue penting, tetapi bukan free performance upgrade.

---

## 21. Eksperimen 7 — Stream Queue dari AMQP Perspective

Queue `stream.case.audit-log` dibuat dengan:

```json
{
  "x-queue-type": "stream",
  "x-max-age": "1D"
}
```

Cek:

```bash
curl -s -u lab:lab http://localhost:15672/api/queues/lab/stream.case.audit-log | jq '{name, type, durable, arguments}'
```

Publish event:

```bash
curl -s -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/exchanges/lab/x.case.event/publish \
  -d '{
    "properties": {"delivery_mode": 2},
    "routing_key": "case.event.opened",
    "payload": "{\"caseId\":\"CASE-STREAM-001\"}",
    "payload_encoding": "string"
  }' | jq
```

Cek stream queue messages:

```bash
make queues
```

Stream berbeda dari classic/quorum queue:

- consumption non-destructive;
- message retained berdasarkan retention;
- consumer bisa replay dari offset;
- AMQP access ada, tetapi fitur stream penuh dipakai lewat stream client/protocol.

Part khusus stream nanti akan memakai Java Stream Client.

Untuk sekarang, cukup pahami:

> Stream di RabbitMQ bisa menjadi audit/event log lokal, sedangkan queue biasa lebih cocok untuk work dispatch.

---

## 22. Export Definitions dari UI/API

Setelah memodifikasi topology manual, export definitions:

```bash
curl -s -u lab:lab http://localhost:15672/api/definitions | jq > exported-definitions.json
```

Atau lewat UI:

```text
Management UI -> Overview -> Export definitions
```

Gunakan export untuk:

- membandingkan expected vs actual topology;
- backup local lab;
- migrasi topology;
- audit perubahan manual;
- membuat PR review untuk topology.

Namun hati-hati:

- definitions export bisa mengandung user/password hash;
- jangan commit secrets;
- bersihkan bagian sensitif sebelum masuk repository.

---

## 23. Import Definitions

Definitions bisa di-load saat startup melalui config:

```ini
management.load_definitions = /etc/rabbitmq/definitions.json
```

Bisa juga import via HTTP API:

```bash
curl -u lab:lab \
  -H "content-type: application/json" \
  -X POST \
  http://localhost:15672/api/definitions \
  -d @rabbitmq/definitions.json
```

Dalam real system, pilihan approach bergantung deployment model:

| Approach | Cocok Untuk |
|---|---|
| Startup definitions | Local/dev/test environment |
| Terraform/provider | Managed infra, platform team |
| Application declarative topology | Service-owned topology |
| RabbitMQ CLI/API migration script | Controlled production rollout |
| Manual UI | Emergency only, lalu harus direconcile |

Prinsip:

> Topology changes are schema migrations for your messaging system.

Jangan menganggap exchange/queue/binding sebagai hal informal.

---

## 24. Declarative Topology vs Manual Topology

Ada dua gaya:

### Manual Topology

Orang membuat exchange/queue/binding lewat UI.

Kelebihan:

- cepat;
- bagus untuk eksperimen;
- mudah dilihat.

Kekurangan:

- tidak repeatable;
- rawan drift;
- susah code review;
- susah audit;
- sulit rollback;
- environment berbeda-beda.

### Declarative Topology

Topology didefinisikan sebagai code/config.

Kelebihan:

- repeatable;
- bisa direview;
- bisa diuji;
- bisa dipromosikan antar environment;
- cocok untuk CI/CD;
- mengurangi drift.

Kekurangan:

- butuh disiplin;
- harus memahami immutable property;
- perubahan breaking harus direncanakan;
- ownership harus jelas.

Rule of thumb:

> Untuk belajar, boleh manual. Untuk sistem serius, topology harus declarative.

---

## 25. Immutable Topology Properties

RabbitMQ akan menolak deklarasi ulang entity dengan property berbeda.

Contoh:

- exchange `x.case.event` sudah dibuat sebagai `topic`;
- aplikasi mencoba declare exchange dengan nama sama tetapi type `direct`;
- RabbitMQ menolak dengan precondition failed.

Ini bukan bug. Ini proteksi.

Mengapa?

Karena perubahan type exchange/queue bisa mengubah semantics routing dan delivery secara radikal.

Beberapa property yang harus dianggap immutable:

- exchange type;
- queue type;
- durability;
- beberapa queue arguments;
- exclusive/auto-delete behavior.

Jika perlu mengubah property fundamental, biasanya strategi yang benar:

1. Buat entity baru dengan nama baru.
2. Tambah binding baru.
3. Deploy producer/consumer compatible.
4. Drain old queue.
5. Remove old topology.

Ini mirip database migration.

---

## 26. Naming Convention Lab

Di lab ini kita memakai prefix:

| Prefix | Makna |
|---|---|
| `x.` | Exchange |
| `q.` | Classic queue |
| `qq.` | Quorum queue |
| `stream.` | Stream queue |
| `dlq` | Dead-letter queue |

Contoh:

```text
x.case.command
x.case.event
q.case.command.evaluate-risk
qq.case.command.generate-notice
stream.case.audit-log
q.case.dlq
```

Naming convention bukan kosmetik. Ia membantu:

- membaca topology;
- debugging incident;
- ownership;
- dashboarding;
- policy application;
- automation.

Misalnya policy:

```text
^qq\.
```

bisa apply hanya ke quorum queues.

Policy:

```text
^stream\.
```

bisa apply hanya ke streams.

---

## 27. Vhost sebagai Isolation Boundary

Vhost `lab` adalah namespace isolasi.

Dalam RabbitMQ:

- exchange berada dalam vhost;
- queue berada dalam vhost;
- bindings berada dalam vhost;
- permission berlaku per vhost;
- nama exchange/queue boleh sama di vhost berbeda.

Gunakan vhost untuk:

- environment isolation;
- tenant isolation;
- domain isolation tertentu;
- experimentation boundary.

Namun jangan berlebihan.

Vhost bukan pengganti domain modelling. Terlalu banyak vhost bisa menyulitkan operasi.

Rule of thumb:

| Use Case | Vhost? |
|---|---|
| Dev/test/prod separation | Ya |
| Tenant hard isolation | Mungkin |
| Setiap microservice satu vhost | Sering berlebihan |
| Setiap feature satu vhost | Biasanya salah |
| Regulatory boundary berbeda | Layak dipertimbangkan |

---

## 28. User dan Permission Model Dasar

Permission RabbitMQ terdiri dari tiga regex:

| Permission | Makna |
|---|---|
| configure | Boleh membuat/mengubah exchange/queue/binding tertentu |
| write | Boleh publish ke exchange tertentu |
| read | Boleh consume dari queue tertentu |

Untuk lab, user `lab` punya semua permission:

```text
configure: .*
write: .*
read: .*
```

Untuk production, ini terlalu luas.

Contoh production-style:

| Service | Configure | Write | Read |
|---|---|---|---|
| case-command-api | `^$` | `^x\.case\.command$` | `^$` |
| risk-worker | `^$` | `^x\.case\.event$` | `^q\.case\.command\.evaluate-risk$` |
| notification-service | `^$` | `^x\.notification\.` | `^q\.case\.event\.notification-service$` |
| topology-migrator | `.*` | `.*` | `.*` |

Prinsip:

> Runtime service tidak otomatis harus punya configure permission.

Banyak organisasi memberi aplikasi permission terlalu luas karena nyaman saat dev. Ini menjadi risiko di production.

---

## 29. Broker Logs: Apa yang Perlu Dicari

Lihat log:

```bash
make logs
```

Hal yang perlu diperhatikan:

- plugin enabled;
- listener started;
- definitions imported;
- user/vhost created;
- memory alarm;
- disk alarm;
- connection accepted/closed;
- authentication failed;
- precondition failed;
- channel error;
- stream subsystem started.

Contoh error penting:

```text
PRECONDITION_FAILED - inequivalent arg 'type' for exchange 'x.case.event'
```

Makna:

Aplikasi mencoba declare exchange dengan property berbeda dari yang sudah ada.

Solusi bukan “restart terus”. Solusi adalah reconcile topology.

---

## 30. Common Local Lab Failure

### Failure 1 — UI Tidak Bisa Login

Cek:

```bash
docker compose logs rabbitmq
```

Kemungkinan:

- user belum dibuat;
- definitions override user;
- volume lama masih menyimpan credential lama;
- typo password.

Solusi:

```bash
make nuke
make up
```

### Failure 2 — Definitions Tidak Ter-load

Cek config:

```bash
docker exec rabbitmq-lab cat /etc/rabbitmq/rabbitmq.conf
```

Cek file mount:

```bash
docker exec rabbitmq-lab ls -l /etc/rabbitmq/definitions.json
```

Cek log import definitions.

### Failure 3 — Stream Queue Tidak Bisa Dibuat

Cek plugin:

```bash
docker exec rabbitmq-lab rabbitmq-plugins list --enabled | grep stream
```

Cek listener:

```bash
docker exec rabbitmq-lab rabbitmq-diagnostics listeners
```

### Failure 4 — Queue Type Salah

Kalau queue sudah terlanjur dibuat dengan type salah, declare ulang tidak akan mengubahnya.

Solusi local:

```bash
make nuke
make up
```

Solusi production:

- buat queue baru;
- migrasi producer/consumer;
- drain old queue;
- remove old queue.

### Failure 5 — Message Tidak Masuk Queue

Cek:

- exchange benar?
- vhost benar?
- routing key benar?
- binding ada?
- alternate exchange?
- mandatory return?
- permission write?

Gunakan:

```bash
make exchanges
make bindings
make queues
```

---

## 31. Designing Experiments Like an Engineer

Untuk setiap eksperimen RabbitMQ, tulis format:

```markdown
## Experiment: <nama>

### Hypothesis
Apa yang saya yakini akan terjadi?

### Setup
Exchange/queue/binding/policy apa yang dipakai?

### Action
Message apa yang dipublish? Consumer apa yang jalan?

### Expected Observation
Queue mana bertambah? Header apa muncul? Log apa muncul?

### Actual Observation
Apa yang benar-benar terjadi?

### Explanation
Kenapa hasilnya seperti itu?

### Design Implication
Apa pelajaran untuk production system?
```

Contoh:

```markdown
## Experiment: Unroutable Command Goes to Alternate Exchange

### Hypothesis
Message dengan routing key tidak dikenal akan masuk q.case.unroutable karena x.case.command punya alternate exchange.

### Setup
Exchange: x.case.command
Alternate exchange: x.case.unroutable
Queue: q.case.unroutable

### Action
Publish routing key case.command.unknown.

### Expected Observation
q.case.unroutable messages_ready bertambah 1.

### Actual Observation
q.case.unroutable messages_ready bertambah 1.

### Explanation
Direct exchange tidak menemukan binding, lalu forward ke alternate exchange fanout.

### Design Implication
Production topology perlu strategi unroutable message agar routing bug tidak silent.
```

Kebiasaan ini akan membedakan engineer yang hanya “bisa pakai RabbitMQ” dari engineer yang bisa mendesain messaging system secara defensible.

---

## 32. Lab Topology Diagram

Topology awal:

```text
                                +---------------------------+
                                |       x.case.unroutable   |
                                |          fanout           |
                                +-------------+-------------+
                                              |
                                              v
                                     q.case.unroutable

+-------------+       direct        +------------------------------+
| Producer    | ------------------> | x.case.command               |
+-------------+                     | alternate: x.case.unroutable |
                                    +---------------+--------------+
                                                    |
                    +-------------------------------+-------------------------------+
                    |                                                               |
 routing key:       v                                                               v
 case.command.      q.case.command.evaluate-risk                  qq.case.command.generate-notice
 evaluate-risk      classic durable queue                         quorum queue


+-------------+       topic         +------------------------------+
| Producer    | ------------------> | x.case.event                 |
+-------------+                     | alternate: x.case.unroutable |
                                    +---------------+--------------+
                                                    |
          +-----------------------------------------+--------------------------------------+
          |                                         |                                      |
          v                                         v                                      v
q.case.event.notification-service      q.case.event.audit-projection          stream.case.audit-log
binding: case.event.*.notification     binding: case.event.#                 binding: case.event.#
-required


+------------------------------+
| x.case.dlx                   |
| topic                        |
+---------------+--------------+
                |
                v
          q.case.dlq
```

Desain ini sengaja memuat beberapa pattern:

- command routing;
- topic event fanout;
- audit subscription;
- stream audit log;
- unroutable handling;
- dead-letter handling;
- quorum queue untuk command penting.

---

## 33. Local Lab vs Production: Apa yang Tidak Sama

Local lab single node tidak bisa membuktikan semua hal.

| Topik | Local Lab Bisa? | Catatan |
|---|---:|---|
| Exchange routing | Ya | Sangat cocok |
| DLQ/retry | Ya | Sangat cocok |
| Consumer ack/redelivery | Ya | Sangat cocok |
| Publisher confirms | Ya | Cocok |
| Quorum queue declaration | Ya | Cocok |
| Quorum HA semantics | Terbatas | Butuh multi-node |
| Stream replay | Ya | Cocok |
| Stream HA semantics | Terbatas | Butuh multi-node |
| Network partition | Tidak cukup | Butuh cluster/chaos lab |
| Production throughput | Tidak | Butuh hardware realistis |
| Security/TLS | Bisa | Perlu config tambahan |
| Prometheus metrics | Ya | Bisa local |

Jadi jangan overclaim.

Local lab membantu memahami semantics, tetapi production readiness butuh:

- cluster testing;
- failure injection;
- load testing;
- monitoring;
- backup/restore drill;
- deployment automation;
- permission hardening;
- capacity planning.

---

## 34. Checklist Lab Selesai

Sebelum lanjut ke part Java, pastikan bisa:

- [ ] `docker compose up -d` berhasil.
- [ ] Management UI terbuka di `http://localhost:15672`.
- [ ] Login user `lab/lab` berhasil.
- [ ] Vhost `lab` tersedia.
- [ ] Exchange `x.case.command` tersedia.
- [ ] Exchange `x.case.event` tersedia.
- [ ] Exchange `x.case.dlx` tersedia.
- [ ] Exchange `x.case.unroutable` tersedia.
- [ ] Queue `q.case.command.evaluate-risk` tersedia.
- [ ] Queue `qq.case.command.generate-notice` bertipe quorum.
- [ ] Queue `stream.case.audit-log` bertipe stream.
- [ ] Publish direct command berhasil.
- [ ] Publish topic event masuk beberapa queue.
- [ ] Unroutable message masuk `q.case.unroutable`.
- [ ] Reject message masuk `q.case.dlq`.
- [ ] TTL retry queue mengembalikan message ke command queue.
- [ ] `make queues` menampilkan queue state.
- [ ] `make bindings` menampilkan binding topology.
- [ ] `rabbitmq-diagnostics listeners` menunjukkan port AMQP, management, dan stream.

Kalau semua checklist ini lolos, lab siap dipakai untuk part berikutnya.

---

## 35. Important Invariants

Ingat invariant berikut:

1. Exchange tidak menyimpan message; exchange merutekan message.
2. Queue menyimpan message sampai dikonsumsi atau expired/dead-lettered.
3. Binding adalah aturan routing dari exchange ke queue/exchange lain.
4. Routing key bermakna berbeda tergantung exchange type.
5. Direct exchange memakai exact match.
6. Topic exchange memakai pattern matching berbasis dot-separated words.
7. Fanout exchange mengabaikan routing key.
8. Unroutable message harus punya strategi.
9. DLQ bukan tempat sampah; DLQ adalah failure evidence.
10. Retry queue adalah topology, bukan hanya kode.
11. Queue type adalah keputusan arsitektur, bukan detail kecil.
12. Banyak property topology bersifat immutable.
13. Vhost adalah namespace dan security boundary.
14. Permission `configure/write/read` harus dipisahkan di production.
15. Definitions file membuat topology repeatable.
16. Local lab membuktikan semantics, bukan production capacity.

---

## 36. Mini Quiz

Jawab tanpa melihat ulang.

### 1. Apa bedanya exchange dan queue?

Exchange merutekan message; queue menyimpan message untuk consumer.

### 2. Kenapa message bisa hilang walaupun publish API mengembalikan sukses?

Karena publish ke exchange bisa sukses tetapi tidak ada binding yang cocok, kecuali publisher memakai mandatory return atau exchange punya alternate exchange.

### 3. Kenapa DLQ penting?

Karena message yang gagal permanen atau tidak bisa diproses harus diisolasi untuk investigasi, bukan terus-menerus mengganggu queue utama.

### 4. Apa risiko retry dengan requeue langsung?

Bisa menciptakan tight retry loop yang membakar CPU, broker, dan downstream dependency.

### 5. Kenapa topology harus declarative?

Agar exchange/queue/binding/policy bisa direview, diuji, diulang, dan tidak drift antar environment.

### 6. Apa yang terjadi jika exchange sudah dibuat sebagai topic lalu aplikasi declare ulang sebagai direct?

RabbitMQ menolak dengan precondition failure karena property exchange tidak ekuivalen.

### 7. Kenapa stream queue berbeda dari classic queue?

Stream menyimpan message sebagai append-only log dengan retention dan non-destructive consumption; classic queue lebih cocok untuk destructive work dispatch.

### 8. Kenapa quorum queue penting?

Quorum queue menyediakan durable replicated queue berbasis consensus untuk workload penting, menggantikan pola classic mirrored queue lama.

---

## 37. Latihan Mandiri

Lakukan latihan berikut sebelum lanjut:

### Latihan 1 — Tambah Queue Subscription Baru

Buat queue:

```text
q.case.event.analytics-projection
```

Bind ke:

```text
x.case.event
routing key: case.event.#
```

Publish event dan buktikan queue menerima copy.

### Latihan 2 — Buat Routing Key Baru

Publish event:

```text
case.event.escalated.notification-required
```

Buktikan event masuk notification service dan audit projection.

### Latihan 3 — Buat Unroutable Event

Publish:

```text
unknown.event.something
```

Buktikan masuk `q.case.unroutable`.

### Latihan 4 — Simulasikan DLQ

Publish command ke `q.case.command.evaluate-risk`, lalu reject tanpa requeue. Buktikan masuk `q.case.dlq`.

### Latihan 5 — Export Definitions

Ubah topology manual, export definitions, lalu bandingkan dengan file awal.

Pertanyaan refleksi:

- Apa yang berubah?
- Apakah perubahan itu intentional?
- Apakah aman di production?
- Siapa owner perubahan tersebut?

---

## 38. Kesimpulan Part 05

Di part ini kita membangun local lab RabbitMQ yang cukup serius untuk eksplorasi lanjutan.

Kita tidak hanya menjalankan container. Kita membangun:

- Docker Compose environment;
- plugin set;
- management UI;
- HTTP API workflow;
- CLI workflow;
- definitions-based topology;
- command exchange;
- event exchange;
- alternate exchange;
- DLX/DLQ;
- retry queue;
- quorum queue;
- stream queue;
- Makefile operasi;
- eksperimen routing, DLQ, retry, quorum, stream.

Fondasi ini akan dipakai berulang pada part berikutnya.

Part berikutnya akan mulai masuk Java client tanpa Spring:

```text
learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-06.md
```

Topik berikutnya:

```text
Java Client Fundamentals tanpa Spring
```

Kita akan membahas:

- ConnectionFactory;
- connection vs channel;
- publisher sederhana;
- consumer manual ack;
- message properties;
- threading model;
- connection recovery;
- resource lifecycle;
- Java concurrency pitfalls;
- bagaimana Java service berinteraksi dengan topology yang sudah kita buat.

---

## Status Seri

Seri belum selesai.

Progress:

- [x] Part 00 — Orientation, Mental Model, dan Scope RabbitMQ Modern
- [x] Part 01 — Messaging Fundamentals yang Spesifik RabbitMQ
- [x] Part 02 — AMQP 0-9-1 Deep Dive
- [x] Part 03 — Exchange Routing Mastery
- [x] Part 04 — Queue Semantics: Classic, Quorum, Stream
- [x] Part 05 — Hands-on Local Lab: Docker, Management UI, CLI, Definitions
- [ ] Part 06 — Java Client Fundamentals tanpa Spring
- [ ] Part 07 — Publisher Reliability: Confirms, Returns, Mandatory, Idempotent Publish
- [ ] Part 08 — Consumer Reliability: Ack, Nack, Reject, Redelivery, Prefetch
- [ ] Part 09 — Retry, Dead Lettering, Poison Message, Parking Lot
- [ ] Part 10 — Spring AMQP Deep Dive
- [ ] Part 11 — Spring Boot Integration Patterns
- [ ] Part 12 — Message Contract Design untuk Java Systems
- [ ] Part 13 — Ordering, Concurrency, Partitioning, and Work Distribution
- [ ] Part 14 — RPC, Request/Reply, Correlation, Timeout
- [ ] Part 15 — Workflow, Saga, and Enforcement Lifecycle Modelling with RabbitMQ
- [ ] Part 16 — RabbitMQ Streams Mental Model
- [ ] Part 17 — RabbitMQ Stream Java Client
- [ ] Part 18 — Super Streams and Partitioned Streaming
- [ ] Part 19 — Stream Deduplication, Filtering, and Replay Patterns
- [ ] Part 20 — Quorum Queues Deep Dive
- [ ] Part 21 — Flow Control, Backpressure, Memory, Disk, and Overload
- [ ] Part 22 — Clustering, High Availability, Network Partitions
- [ ] Part 23 — Federation, Shovel, Multi-Region, and Edge Messaging
- [ ] Part 24 — Security, TLS, AuthN/AuthZ, Multi-Tenancy
- [ ] Part 25 — Observability: Metrics, Logs, Tracing, and Message Forensics
- [ ] Part 26 — Performance Engineering and Benchmarking
- [ ] Part 27 — Production Topology Design Patterns
- [ ] Part 28 — Anti-Patterns and Failure Case Studies
- [ ] Part 29 — Testing Strategy for RabbitMQ-Based Java Systems
- [ ] Part 30 — Migration, Refactoring, and Legacy RabbitMQ Systems
- [ ] Part 31 — Architecture Decision Framework
- [ ] Part 32 — End-to-End Case Study
- [ ] Part 33 — Production Runbook and Operational Playbook
- [ ] Part 34 — Mastery Review, Heuristics, and Final Mental Models

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-04.md">⬅️ Part 04 — Queue Semantics: Classic, Quorum, Stream</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-rabbitmq-messaging-streaming-mastery-for-java-engineers-part-06.md">Part 06 — Java Client Fundamentals tanpa Spring ➡️</a>
</div>
