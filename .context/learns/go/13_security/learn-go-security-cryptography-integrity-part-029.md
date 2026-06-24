# learn-go-security-cryptography-integrity-part-029.md

# Part 029 — Secrets Management in Go: Config vs Secret, Environment Risk, File-Mounted Secret, KMS, Vault, AWS SSM/Secrets Manager, Rotation, Lease, Reload, and Blast-Radius Design

> Seri: `learn-go-security-cryptography-integrity`  
> Part: `029 / 034`  
> Target: Go 1.26.x  
> Audiens: Java software engineer / tech lead yang ingin membangun Go services dengan standar internal engineering handbook level production/regulatory systems  
> Status seri: **belum selesai**

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita membahas secure audit logging: bagaimana sistem mencatat event yang bisa dipertanggungjawabkan, tidak bocor, tidak mudah dipalsukan, dan tetap berguna saat incident response.

Part ini membahas **secrets management**: bagaimana Go service mendapatkan, memakai, merotasi, membatasi, dan menghapus kredensial serta material rahasia tanpa menjadikan secret sebagai liability permanen.

Kita akan membahas:

1. perbedaan **configuration**, **secret**, **key**, **token**, **credential**, **certificate**, dan **identifier**;
2. kenapa menyimpan secret di source code, image, log, `.env`, CI variable, atau Kubernetes Secret tanpa kontrol tambahan adalah desain rapuh;
3. kapan environment variable bisa diterima dan kapan berbahaya;
4. kapan file-mounted secret lebih baik daripada env var;
5. perbedaan AWS Systems Manager Parameter Store, AWS Secrets Manager, AWS KMS, HashiCorp Vault, Kubernetes Secret, dan external secret pattern;
6. cara mendesain reload/rotation tanpa restart besar-besaran;
7. static secret vs dynamic secret vs leased secret;
8. blast-radius design: bagaimana memastikan satu secret bocor tidak menghancurkan seluruh estate;
9. Go implementation pattern: provider abstraction, cache TTL, watcher, redaction, zero logging, and failure behavior;
10. checklist production readiness.

Part ini **bukan** tutorial klik-klik AWS/Vault/Kubernetes. Fokusnya adalah mental model dan desain yang bisa dipertahankan dalam design review, code review, audit, dan incident response.

---

## 1. Prinsip Pertama: Secret Bukan Sekadar String

Banyak codebase memperlakukan secret sebagai string:

```go
password := os.Getenv("DB_PASSWORD")
apiKey := os.Getenv("PAYMENT_API_KEY")
jwtSecret := os.Getenv("JWT_SECRET")
```

Secara teknis itu benar: di runtime, secret memang sering berbentuk byte/string.

Tetapi secara security engineering, secret adalah:

> **A short-lived or long-lived authority-bearing material whose disclosure allows an attacker to impersonate, decrypt, sign, access, or modify something beyond normal authorization.**

Artinya, secret bukan hanya “data sensitif”. Secret adalah **capability**.

Jika attacker mendapatkan:

| Secret | Authority yang didapat attacker |
|---|---|
| Database password | membaca/mengubah database sesuai privilege user tersebut |
| AWS access key | memanggil AWS API sesuai IAM policy attached |
| HMAC webhook secret | memalsukan webhook/event seolah dari trusted system |
| JWT signing key | menerbitkan token palsu jika key untuk signing |
| TLS private key | impersonasi endpoint / decrypt traffic lama pada beberapa konfigurasi legacy |
| OAuth client secret | impersonasi confidential client |
| KMS decrypt permission | membuka ciphertext/data key jika context juga diketahui |
| Vault token | membaca/renew secret sesuai Vault policy |
| Kubernetes service account token | memanggil Kubernetes API sesuai RBAC service account |

Jadi pertanyaan utama bukan:

> “Secret ini disimpan di mana?”

Pertanyaan yang benar:

> “Authority apa yang diberikan secret ini, siapa yang bisa mendapatkannya, berapa lama valid, bagaimana diputar, bagaimana dicabut, dan apa kerusakan maksimum jika bocor?”

---

## 2. Taxonomy: Config vs Secret vs Key vs Credential

### 2.1 Configuration

Configuration adalah nilai yang mengubah perilaku aplikasi tetapi tidak memberi authority jika bocor.

Contoh:

```text
HTTP_PORT=8080
LOG_LEVEL=INFO
FEATURE_X_ENABLED=true
DB_HOST=postgres.internal
DB_PORT=5432
```

`DB_HOST` bisa sensitif dalam arti memberi informasi topology, tetapi bukan secret murni karena attacker tidak otomatis mendapat access authority hanya dari host.

### 2.2 Secret

Secret adalah data yang jika bocor memberi authority.

```text
DB_PASSWORD=...
REDIS_PASSWORD=...
JWT_SIGNING_KEY=...
HMAC_WEBHOOK_SECRET=...
API_CLIENT_SECRET=...
TLS_PRIVATE_KEY=...
```

### 2.3 Credential

Credential adalah material untuk autentikasi ke sistem lain.

Contoh:

```text
username + password
access key id + secret access key
client id + client secret
certificate + private key
bearer token
```

Credential sering terdiri dari bagian **identifier** dan **secret**.

```text
AWS_ACCESS_KEY_ID      -> identifier, bukan secret utama, tetapi tetap jangan log sembarangan
AWS_SECRET_ACCESS_KEY  -> secret
```

### 2.4 Cryptographic key

Cryptographic key adalah secret yang digunakan untuk operasi crypto:

```text
AES key
HMAC key
Ed25519 private key
RSA private key
KMS data key plaintext
JWT signing private key
```

Key punya lifecycle lebih ketat daripada password biasa:

- generated by approved randomness;
- usage constrained;
- algorithm-bound;
- versioned;
- rotated;
- revoked;
- archived or destroyed;
- sometimes wrapped by another key.

### 2.5 Token

Token adalah bearer artifact atau proof artifact.

| Token type | Jika bocor? | Catatan |
|---|---|---|
| Bearer access token | attacker bisa akses resource sampai expired/revoked | harus short-lived |
| Refresh token | attacker bisa memperpanjang session | harus rotation + reuse detection |
| Vault token | attacker bisa baca secret sesuai policy | harus TTL + least privilege |
| Kubernetes service account token | attacker bisa akses K8s API | harus projected short-lived token, RBAC ketat |
| CSRF token | attacker bisa bypass CSRF jika juga punya session context | jangan log |
| Reset password token | takeover account | one-time + short-lived + hashed at rest |

### 2.6 Certificate and private key

Certificate bukan secret; private key adalah secret.

```text
server.crt     -> public claim signed by CA
server.key     -> private signing/decryption/authentication material
ca.crt         -> trust anchor; public but integrity-critical
```

Trust anchor seperti `ca.crt` tidak rahasia, tetapi jika attacker bisa menggantinya, mereka bisa mengubah siapa yang dipercaya aplikasi. Jadi ia masuk kategori **integrity-critical config**.

---

## 3. Mental Model: Secret Flow, Bukan Secret Location

Secret management tidak bisa diselesaikan hanya dengan memilih “pakai Vault” atau “pakai AWS Secrets Manager”. Yang harus didesain adalah flow.

```mermaid
flowchart LR
    A[Secret Authority / Owner] --> B[Secret Store]
    B --> C[Identity & Access Policy]
    C --> D[Delivery Mechanism]
    D --> E[Go Process]
    E --> F[In-Memory Use]
    E --> G[Outbound Dependency]
    E --> H[Logs / Metrics / Traces]
    B --> I[Rotation / Versioning]
    I --> D
    J[Incident / Revocation] --> B
    J --> C
    J --> G
```

Untuk setiap secret, jawab pertanyaan berikut:

1. Siapa owner-nya?
2. Sistem mana yang menyimpan canonical value?
3. Identity apa yang boleh membaca?
4. Policy apa yang membatasi baca/tulis/rotate?
5. Bagaimana secret dikirim ke process?
6. Berapa lama process boleh menyimpannya?
7. Bagaimana process tahu secret berubah?
8. Apa yang terjadi jika reload gagal?
9. Apakah secret pernah masuk log, metric, trace, panic, heap dump, core dump, atau crash report?
10. Bagaimana revoke dilakukan saat incident?

---

## 4. Rule Utama: Jangan Menyamakan Secret Store dengan Secret Management

**Secret store** adalah tempat penyimpanan.

**Secret management** adalah keseluruhan sistem:

- identity;
- access control;
- storage encryption;
- retrieval;
- delivery;
- cache;
- reload;
- rotation;
- revocation;
- audit;
- monitoring;
- blast-radius control;
- incident playbook.

Kubernetes Secret, Vault, AWS SSM, AWS Secrets Manager, file mount, environment variable, dan encrypted config semuanya hanyalah komponen.

Aplikasi yang memakai Vault pun bisa insecure jika:

- memakai Vault root token;
- secret di-cache selamanya;
- secret masuk log;
- semua service memakai policy yang sama;
- tidak ada lease renewal/revocation handling;
- rotation butuh redeploy manual;
- audit log Vault tidak dimonitor;
- fallback default credentials ada di code.

Sebaliknya, sistem sederhana dengan SSM SecureString bisa cukup aman untuk use case tertentu jika:

- IAM policy least privilege;
- secret scoped per service/env;
- secret tidak masuk log;
- rotation playbook jelas;
- credential downstream bisa menerima overlap rotation;
- pod/task identity benar;
- blast radius kecil.

---

## 5. Threat Model Secrets Management

### 5.1 Attacker capability

Threat model secret harus mempertimbangkan attacker yang bisa:

| Capability | Contoh |
|---|---|
| Read source code | leaked repo, insider, vendor access |
| Read CI logs | build failure prints env |
| Read container image | secret baked into layer |
| Read Kubernetes Secret | RBAC too broad |
| Create Pod in namespace | indirect secret exfiltration |
| Exec into container | `kubectl exec`, debug container |
| Read process env | `/proc/<pid>/environ`, crash dump, debug endpoint |
| Read mounted files | compromised container user |
| Read memory | RCE, heap dump, core dump |
| Read app logs/traces | accidental logging |
| Call secret store API | stolen IAM role/Vault token |
| MITM secret retrieval | TLS/trust issue |
| Modify secret | malicious rotation, poison config |
| Replay old secret | rollback attack |

### 5.2 STRIDE mapping

| STRIDE | Secrets management failure |
|---|---|
| Spoofing | attacker steals credential/token and impersonates service |
| Tampering | attacker modifies secret value or trust anchor |
| Repudiation | no audit trail of who read/rotated secret |
| Information disclosure | secret in logs, CI, image, env, etcd, trace |
| Denial of service | secret store outage prevents startup/reload |
| Elevation of privilege | broad secret policy gives access beyond intended service |

### 5.3 Security invariants

Untuk Go services, tetapkan invariants eksplisit:

```text
Invariant S1:
No secret value may be logged, traced, returned in HTTP response, included in metrics label, or stored in panic output.

Invariant S2:
A service may only read secrets required for its own runtime role and environment.

Invariant S3:
Every long-lived secret must have an owner, rotation mechanism, last-rotated timestamp, and incident revocation plan.

Invariant S4:
Secret rotation must not require source-code change.

Invariant S5:
A secret compromise must be bounded by environment, tenant, service, action, and time wherever possible.

Invariant S6:
If the secret provider fails, the application must fail closed for authority acquisition but may continue with still-valid cached credentials within an explicit TTL if business risk allows.

Invariant S7:
Secret identity and secret value must never be confused: identifiers may be logged carefully, values must not.
```

---

## 6. Anti-Patterns yang Harus Dihapus dari Muscle Memory

### 6.1 Secret di source code

```go
const dbPassword = "P@ssw0rd!"
const jwtSecret = "dev-secret-but-now-in-prod"
```

Masalah:

- tersimpan di Git history;
- masuk code review, fork, cache, backup;
- susah rotate;
- semua environment bisa memakai secret yang sama;
- attacker hanya perlu read-only repo access.

### 6.2 Secret di container image

```dockerfile
ENV DB_PASSWORD=supersecret
COPY prod.pem /app/prod.pem
```

Masalah:

- image layer immutable dan bisa diinspeksi;
- registry, scanner, cache, artifact store menyimpan secret;
- rotation butuh rebuild + redeploy;
- rollback image bisa menghidupkan secret lama.

### 6.3 Secret di `.env` yang ikut commit

`.env` berguna untuk local development, tetapi harus dianggap sebagai high-risk file.

Minimal:

```gitignore
.env
.env.*
!.env.example
```

`.env.example` boleh berisi nama variable dan placeholder, bukan value nyata.

### 6.4 Secret di log

```go
slog.Info("connecting", "dsn", dsn)
```

DSN sering berisi password:

```text
postgres://user:password@host:5432/db
```

Gunakan redaction type dan structured safe fields.

### 6.5 One secret for everything

Satu secret dipakai untuk:

- signing JWT;
- HMAC webhook;
- encrypt data;
- call external API;
- admin database.

Ini menghancurkan key separation. Jika bocor, semua boundary runtuh.

### 6.6 Long-lived shared admin credential

```text
DB_USER=admin
DB_PASSWORD=shared-by-all-services
```

Masalah:

- tidak ada attribution;
- blast radius besar;
- rotation sulit karena banyak consumer;
- least privilege mustahil.

### 6.7 Secret cache tanpa TTL

```go
var globalSecret string
```

Jika secret rotated atau revoked, process tetap memakai secret lama sampai restart. Ini bukan rotation; ini “scheduled outage waiting to happen”.

### 6.8 “Encryption solves secret leakage”

Secret yang encrypted di config tetap butuh decryption key. Jika decryption key ada di image/env/CI yang sama, kita hanya memindahkan masalah.

---

## 7. Environment Variables: Praktis, Tetapi Bukan Tempat Ajaib

Go menyediakan `os.Getenv` dan `os.LookupEnv` untuk membaca environment variable.

```go
value := os.Getenv("DB_PASSWORD")
```

Lebih baik gunakan `LookupEnv` jika ingin membedakan value kosong dan variable yang tidak ada:

```go
value, ok := os.LookupEnv("DB_PASSWORD")
if !ok {
    return errors.New("missing DB_PASSWORD")
}
if value == "" {
    return errors.New("DB_PASSWORD is empty")
}
```

### 7.1 Kapan env var masih acceptable?

Env var bisa diterima untuk:

- local development;
- non-sensitive config;
- bootstrap pointer ke secret provider;
- short-lived container runtime injection dengan platform controls;
- transitional architecture.

Contoh bootstrap pointer:

```text
SECRETS_PROVIDER=aws-sm
DB_SECRET_ARN=arn:aws:secretsmanager:...
VAULT_ADDR=https://vault.internal
```

Di sini env var tidak memuat password langsung, tetapi locator dan mode.

### 7.2 Risiko env var

Environment variable punya risiko:

1. bisa terlihat lewat debugging tooling;
2. bisa masuk crash diagnostics;
3. bisa terbaca oleh child process jika environment diwariskan;
4. sulit dirotasi tanpa restart process;
5. sering tercetak oleh panic/debug dump/config dump;
6. sulit membatasi akses per secret setelah process berjalan;
7. di Kubernetes, env var dari Secret tidak otomatis berubah di process ketika Secret di-update.

### 7.3 Rule praktis

| Situation | Recommendation |
|---|---|
| non-sensitive config | env var OK |
| secret local dev | env var acceptable dengan `.env` ignored dan secret dummy |
| prod database password | prefer file mount / secret provider / dynamic credential |
| TLS private key | file mount with permissions / cert manager / SPIFFE/SPIRE |
| JWT signing private key | KMS/HSM/Vault signing API atau mounted key dengan strict controls |
| API key to third-party | secret store + rotation plan |
| secret that must rotate without restart | avoid env var; use file watcher/provider reload |
| secret with lease | provider/agent with lease renewal, not static env var |

---

## 8. File-Mounted Secrets

File-mounted secret adalah pattern umum di Kubernetes, ECS, Nomad, systemd, Vault Agent, Secrets Store CSI Driver, dan cert-manager.

Contoh path:

```text
/run/secrets/db/password
/var/run/secrets/app/hmac.key
/etc/tls/tls.crt
/etc/tls/tls.key
```

### 8.1 Kelebihan file-mounted secret

- bisa diatur file permission;
- bisa di-update atomically oleh sidecar/agent/platform;
- lebih mudah di-watch untuk reload;
- tidak otomatis diwariskan ke child process;
- bisa dipisahkan per-container;
- cocok untuk certificate/private key rotation.

### 8.2 Risiko file-mounted secret

- process yang compromised tetap bisa membaca file;
- file permission salah bisa membuka secret ke user lain;
- path traversal bug bisa membaca secret file;
- volume mount bisa terlalu luas;
- secret lama bisa tertinggal jika update mechanism buruk;
- log/debug endpoint bisa mencetak file content;
- backup/snapshot node bisa membawa secret.

### 8.3 Pattern atomic file reload

Provider/agent sering menulis file baru lalu rename symlink/atomic path. Go service harus membaca ulang path saat event terjadi, bukan menyimpan file descriptor lama selamanya.

```mermaid
sequenceDiagram
    participant Store as Secret Store
    participant Agent as Sidecar/Agent
    participant FS as Mounted Volume
    participant App as Go Service

    Store->>Agent: New secret version
    Agent->>FS: Write new file/temp
    Agent->>FS: Atomic rename/symlink swap
    FS-->>App: fsnotify event / periodic poll
    App->>FS: Read new value
    App->>App: Validate and swap in-memory config
```

### 8.4 Safe file read helper

```go
package secretfile

import (
    "errors"
    "fmt"
    "os"
)

const MaxSecretBytes = 64 * 1024

func ReadSecretFile(path string) ([]byte, error) {
    f, err := os.Open(path)
    if err != nil {
        return nil, fmt.Errorf("open secret file: %w", err)
    }
    defer f.Close()

    info, err := f.Stat()
    if err != nil {
        return nil, fmt.Errorf("stat secret file: %w", err)
    }
    if info.IsDir() {
        return nil, errors.New("secret path is directory")
    }
    if info.Size() > MaxSecretBytes {
        return nil, fmt.Errorf("secret file too large: %d", info.Size())
    }

    b := make([]byte, info.Size())
    n, err := f.Read(b)
    if err != nil {
        return nil, fmt.Errorf("read secret file: %w", err)
    }
    return b[:n], nil
}
```

Untuk production, tambah:

- trimming newline hanya jika format memang textual;
- ownership/permission check jika applicable;
- no logging of content;
- path allowlist;
- symlink policy;
- reload validation before swap.

---

## 9. Kubernetes Secrets: Berguna, Tetapi Jangan Salah Paham

Kubernetes Secret adalah object untuk menyimpan data sensitif seperti password, token, atau key. Secret dapat dipakai oleh Pod lewat volume mount atau environment variable. Tetapi Kubernetes documentation menekankan bahwa Secret values di-encode base64, bukan encrypted secara otomatis dalam semua konfigurasi. Secret di etcd harus dikonfigurasi encryption at rest dan diakses dengan RBAC least privilege.

### 9.1 Kubernetes Secret baseline

Kubernetes Secret:

- cocok untuk small secret;
- namespace-scoped;
- bisa mounted as volume;
- bisa exposed as env var;
- bisa dipakai sebagai image pull secret;
- bisa immutable;
- bisa diintegrasikan dengan external secret store.

### 9.2 Design hazard

Kubernetes documentation memperingatkan beberapa hal penting:

1. Secret default disimpan unencrypted di etcd jika encryption at rest tidak dikonfigurasi.
2. Siapa pun yang punya API access memadai bisa retrieve/modify Secret.
3. User yang bisa membuat Pod di namespace bisa secara tidak langsung membaca Secret di namespace tersebut.
4. `list` access ke Secrets secara implisit memberi kemampuan fetch secret contents.
5. Base64 bukan encryption.

### 9.3 Env var vs volume di Kubernetes

| Delivery | Rotation behavior | Risk |
|---|---|---|
| Secret as env var | process tidak otomatis berubah; butuh restart | mudah bocor ke debug/env dump |
| Secret as volume | kubelet bisa update mounted data eventually | app harus reread/watch |
| External Secrets CSI | secret tetap di external store, mounted ke pod | tergantung provider/driver/RBAC |
| Sidecar agent | bisa handle lease/renewal/template | operational complexity |

### 9.4 K8s Secret rules for Go service

Untuk production Go service:

1. jangan mount seluruh Secret bundle jika hanya perlu satu key;
2. gunakan namespace isolation;
3. RBAC: service account hanya get Secret spesifik yang dibutuhkan;
4. hindari `list/watch secrets` untuk app service account;
5. enable encryption at rest;
6. audit read events;
7. gunakan file-mounted secret jika reload penting;
8. jangan gunakan env var untuk secret yang butuh rotation tanpa restart;
9. gunakan external secret store untuk high-value secret;
10. jangan commit Secret manifest dengan base64 value nyata.

### 9.5 Example Secret mount

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: payment-api
spec:
  serviceAccountName: payment-api
  containers:
    - name: app
      image: example/payment-api:1.2.3
      volumeMounts:
        - name: db-password
          mountPath: /run/secrets/db
          readOnly: true
      env:
        - name: DB_PASSWORD_FILE
          value: /run/secrets/db/password
  volumes:
    - name: db-password
      secret:
        secretName: payment-api-db
        items:
          - key: password
            path: password
```

Pattern ini lebih baik daripada:

```yaml
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: payment-api-db
        key: password
```

bila rotation/reload diperlukan.

---

## 10. AWS Systems Manager Parameter Store vs AWS Secrets Manager vs AWS KMS

### 10.1 AWS Systems Manager Parameter Store

Parameter Store dapat menyimpan configuration data dan parameter bertipe `String`, `StringList`, dan `SecureString`. Untuk `SecureString`, AWS Systems Manager Parameter Store memakai AWS KMS untuk encrypt/decrypt parameter values.

Cocok untuk:

- hierarchical configuration;
- simple secret;
- low-frequency retrieval;
- bootstrap configuration;
- app config with IAM control;
- cheaper/simple setup.

Limitasi desain:

- bukan full lifecycle secrets manager;
- rotation biasanya harus dibangun sendiri;
- size/performance/throughput perlu diperhatikan;
- eventual IAM/sprawl risk;
- parameter naming menjadi policy boundary penting.

### 10.2 AWS Secrets Manager

AWS Secrets Manager purpose-built untuk secret lifecycle. Ia mendukung versioning, automatic rotation, IAM policy, integration dengan beberapa database, dan custom Lambda rotation.

Cocok untuk:

- database credentials;
- third-party API keys;
- secret yang butuh rotation lifecycle;
- credentials yang perlu version staging seperti `AWSCURRENT`, `AWSPREVIOUS`, `AWSPENDING`;
- environment dengan audit/rotation requirement lebih tinggi.

### 10.3 AWS KMS

AWS KMS bukan secret store biasa. KMS adalah managed key service untuk operasi crypto dan key protection.

Cocok untuk:

- envelope encryption;
- generating/decrypting data keys;
- signing/verifying dengan asymmetric KMS keys;
- access control terhadap decrypt/sign authority;
- central audit of key usage.

### 10.4 Decision table

| Need | Prefer |
|---|---|
| non-sensitive app config | Parameter Store String / config service |
| simple encrypted parameter | Parameter Store SecureString |
| rotating DB credential | Secrets Manager / Vault dynamic DB secrets |
| high-value signing key | KMS/HSM/Vault transit/signing API |
| envelope encryption | KMS + data key / Vault transit |
| dynamic short-lived DB users | Vault database secrets engine / cloud-native IAM auth |
| Kubernetes pod secret delivery | CSI/agent/external secret pattern |
| local development | `.env` with dummy/dev-only secrets and no commit |

---

## 11. HashiCorp Vault: Static Secrets, Dynamic Secrets, Lease, and Revocation

Vault sering dipakai untuk secrets management karena mendukung:

- static KV secrets;
- dynamic secrets;
- lease/TTL;
- renewal;
- revocation;
- identity-based policies;
- audit devices;
- transit encryption/signing;
- PKI issuance.

### 11.1 Static secret

Static secret sudah ada sebelum dibaca.

Contoh:

```text
kv/prod/payment-api/db-password
```

Jika bocor, secret tetap valid sampai dirotasi/revoked secara manual atau otomatis.

### 11.2 Dynamic secret

Dynamic secret dibuat saat diminta.

Contoh:

```text
Vault creates temporary DB username/password for payment-api.
```

Kelebihan:

- secret tidak ada sampai dibutuhkan;
- TTL terbatas;
- bisa revoked;
- blast radius lebih kecil;
- attribution lebih baik;
- tidak perlu shared long-lived password.

### 11.3 Lease

Dengan dynamic secret dan service token, Vault membuat lease yang berisi TTL dan renewability. Setelah lease expired, consumer tidak lagi bisa mengasumsikan data tersebut valid. Dynamic secret bisa renewed atau revoked sesuai policy dan type.

### 11.4 Lease-aware Go service

Go service yang memakai leased secrets harus punya state machine:

```mermaid
stateDiagram-v2
    [*] --> Uninitialized
    Uninitialized --> Active: fetch secret + valid lease
    Active --> Renewing: before TTL threshold
    Renewing --> Active: renew success
    Renewing --> Refreshing: renew denied / non-renewable
    Refreshing --> Active: fetch new secret success
    Refreshing --> Degraded: provider unavailable and old secret still within grace
    Degraded --> Active: fetch success
    Degraded --> FailingClosed: grace expired
    FailingClosed --> Active: fetch success
```

### 11.5 Vault Agent vs direct app integration

| Pattern | Pros | Cons |
|---|---|---|
| App calls Vault directly | explicit control, app knows lease | SDK complexity, token handling in app |
| Vault Agent sidecar writes file | app simple, agent handles auth/renewal | app must reload file, operational sidecar complexity |
| CSI provider mount | Kubernetes-native mount | lease renewal semantics/provider behavior must be understood |
| External Secrets to K8s Secret | app simple | may copy secret into Kubernetes etcd; rotation timing matters |

### 11.6 Go design recommendation

For most services:

- prefer agent/file delivery for ordinary credentials;
- prefer direct API only if app must understand lease and dynamic credential lifecycle;
- prefer transit/KMS API for high-value signing/decrypting so private key never enters app memory;
- keep Vault token out of logs and metrics;
- scope Vault policy per service/environment;
- use TTL and renewal deliberately.

---

## 12. Secret Retrieval Pattern in Go

### 12.1 Provider abstraction

Jangan biarkan business code memanggil `os.Getenv`, AWS SDK, Vault SDK, dan Kubernetes file path secara acak.

Buat boundary:

```go
package secrets

import (
    "context"
    "time"
)

type Name string

type Version string

type Secret struct {
    Name      Name
    Version   Version
    Value     []byte
    ExpiresAt time.Time // zero if not leased/expiring
}

type Provider interface {
    Get(ctx context.Context, name Name) (Secret, error)
}
```

Business code menerima domain-specific dependency:

```go
type DBPasswordProvider interface {
    Current(ctx context.Context) ([]byte, error)
}
```

Jangan expose generic secret provider ke seluruh codebase jika tidak perlu. Itu membuat authorization boundary kabur.

### 12.2 Typed secret names

```go
type SecretName string

const (
    SecretDBPassword      SecretName = "prod/payment-api/db/password"
    SecretWebhookHMACKey  SecretName = "prod/payment-api/webhook/hmac-key"
    SecretOIDCClientSecret SecretName = "prod/payment-api/oidc/client-secret"
)
```

Lebih baik lagi: jangan compile prod names ke binary jika environment berbeda; gunakan mapping config yang non-secret.

### 12.3 Redacted secret wrapper

```go
package secrets

import "fmt"

type RedactedBytes struct {
    b []byte
}

func NewRedactedBytes(b []byte) RedactedBytes {
    cp := make([]byte, len(b))
    copy(cp, b)
    return RedactedBytes{b: cp}
}

func (r RedactedBytes) BytesCopy() []byte {
    cp := make([]byte, len(r.b))
    copy(cp, r.b)
    return cp
}

func (r RedactedBytes) String() string { return "[REDACTED]" }
func (r RedactedBytes) GoString() string { return "[REDACTED]" }
func (r RedactedBytes) Format(s fmt.State, verb rune) { _, _ = s.Write([]byte("[REDACTED]")) }
```

Catatan realistis: wrapper ini tidak membuat secret hilang dari memory. Ia hanya mencegah accidental logging lewat formatting umum.

### 12.4 Config struct: split secret locator and secret value

Buruk:

```go
type Config struct {
    DBPassword string
}
```

Lebih baik:

```go
type Config struct {
    DBHost             string
    DBPort             int
    DBUser             string
    DBPasswordFile     string
    DBPasswordSecretID string
}
```

Value secret diambil oleh runtime provider, bukan disimpan sebagai config biasa.

---

## 13. Secret Cache: TTL, Version, and Failure Behavior

Secret retrieval ke external store punya latency, cost, rate limit, dan availability risk. Karena itu banyak service melakukan cache.

Cache harus eksplisit:

```go
type CachePolicy struct {
    SoftTTL       time.Duration
    HardTTL       time.Duration
    RefreshJitter time.Duration
    FailClosed    bool
}
```

### 13.1 Soft TTL vs hard TTL

| TTL | Meaning |
|---|---|
| Soft TTL | setelah lewat, refresh async/sync dicoba, tetapi old secret masih bisa dipakai |
| Hard TTL | setelah lewat, old secret tidak boleh dipakai |
| Lease TTL | provider menjamin validity sampai waktu tertentu |
| Credential expiry | downstream menolak setelah waktu tertentu |

### 13.2 Failure modes

| Failure | Safe response |
|---|---|
| provider timeout during startup | fail closed unless local dev/test explicitly allows fallback |
| provider timeout during refresh | keep old secret until hard TTL if allowed |
| provider returns malformed secret | reject and keep last known good until hard TTL |
| provider says revoked | stop using immediately |
| downstream auth fails | refresh secret, then retry bounded once if idempotent/safe |
| rotation overlap missing | fail fast and alert; do not brute-force secret store |

### 13.3 Cache implementation sketch

```go
package secrets

import (
    "context"
    "errors"
    "sync"
    "time"
)

type CachedProvider struct {
    src     Provider
    softTTL time.Duration
    hardTTL time.Duration

    mu    sync.RWMutex
    items map[Name]cachedItem
}

type cachedItem struct {
    secret    Secret
    fetchedAt time.Time
}

func NewCachedProvider(src Provider, softTTL, hardTTL time.Duration) *CachedProvider {
    return &CachedProvider{
        src:     src,
        softTTL: softTTL,
        hardTTL: hardTTL,
        items:   make(map[Name]cachedItem),
    }
}

func (p *CachedProvider) Get(ctx context.Context, name Name) (Secret, error) {
    now := time.Now()

    p.mu.RLock()
    item, ok := p.items[name]
    if ok && now.Sub(item.fetchedAt) < p.softTTL {
        p.mu.RUnlock()
        return cloneSecret(item.secret), nil
    }
    p.mu.RUnlock()

    fresh, err := p.src.Get(ctx, name)
    if err == nil {
        p.mu.Lock()
        p.items[name] = cachedItem{secret: cloneSecret(fresh), fetchedAt: now}
        p.mu.Unlock()
        return cloneSecret(fresh), nil
    }

    p.mu.RLock()
    item, ok = p.items[name]
    p.mu.RUnlock()
    if ok && now.Sub(item.fetchedAt) < p.hardTTL {
        return cloneSecret(item.secret), nil
    }

    return Secret{}, errors.Join(errors.New("secret unavailable and cache expired"), err)
}

func cloneSecret(s Secret) Secret {
    cp := make([]byte, len(s.Value))
    copy(cp, s.Value)
    s.Value = cp
    return s
}
```

Security notes:

- clone avoids accidental mutation by callers;
- this does not zero old memory reliably;
- cache TTL must be tied to secret risk;
- don't use cache as revocation bypass;
- add metrics without secret names if names are sensitive;
- add singleflight/in-flight dedup to avoid thundering herd.

---

## 14. Rotation: The Hard Part Is Not “Change the String”

Rotation means changing secret material while keeping system correct.

The hard questions:

1. Can producer and consumer overlap old/new?
2. Is secret used for inbound verification or outbound authentication?
3. Is rotation synchronous or eventual?
4. How are versions represented?
5. How is rollback prevented?
6. How is old secret revoked?
7. What happens to long-lived connections?
8. What happens to cached clients?
9. What metrics prove rotation succeeded?
10. What playbook exists if new secret breaks production?

### 14.1 Rotation categories

| Secret type | Rotation pattern |
|---|---|
| DB password | create/update credential, overlap, update app, revoke old |
| API key | provision new key, deploy/reload, verify traffic, delete old |
| HMAC inbound verification key | accept old+new during window, sign outbound with new, then retire old |
| JWT signing key | publish JWKS with old+new, sign new token with new `kid`, retain old until tokens expire |
| TLS certificate | reload cert/key, overlap trust, monitor handshake failures |
| KMS key | new key version for new encryption; old versions decrypt existing data |
| Vault dynamic secret | renew or fetch new before lease expiry |

### 14.2 Inbound vs outbound secret

**Outbound credential**: app uses secret to call another system.

```text
Go service -> DB/API
```

Rotation is mostly about updating app credential before downstream rejects old.

**Inbound verification secret**: app uses secret to verify calls from others.

```text
Third-party webhook -> Go service verifies HMAC
```

Rotation needs multi-key verify window:

```go
type Verifier struct {
    keys []VersionedKey // current + previous during overlap
}
```

### 14.3 Versioned secret envelope

Secret stores should return metadata:

```json
{
  "version": "2026-06-24T12:00:00Z",
  "algorithm": "HMAC-SHA-256",
  "value": "base64...",
  "not_before": "2026-06-24T12:00:00Z",
  "not_after": "2026-07-24T12:00:00Z"
}
```

Do not treat all secrets as anonymous strings.

### 14.4 Rotation state machine

```mermaid
stateDiagram-v2
    [*] --> OldActive
    OldActive --> NewProvisioned: create new version
    NewProvisioned --> DualUse: deploy/reload consumers
    DualUse --> NewPrimary: producers sign/auth with new
    NewPrimary --> OldRetained: wait for token/session/message TTL
    OldRetained --> OldRevoked: revoke/delete old
    OldRevoked --> [*]

    NewProvisioned --> Rollback: validation failure
    DualUse --> Rollback: error spike
    Rollback --> OldActive
```

### 14.5 Rotation metrics

Track:

```text
secret_fetch_success_total{provider,secret_class}
secret_fetch_error_total{provider,reason}
secret_version_current{secret_class,version_hash}
secret_reload_success_total{secret_class}
secret_reload_reject_total{secret_class,reason}
downstream_auth_failure_total{dependency}
old_secret_verification_total{secret_class}
```

Avoid raw secret names if names reveal sensitive architecture. Use stable non-secret class labels.

---

## 15. Reload Without Unsafe Partial State

A common bug: reload mutates global config field-by-field. During reload, some goroutines see old DB password with new host or old TLS cert with new CA.

Use atomic snapshot swap.

```go
package runtimeconfig

import "sync/atomic"

type SecretsSnapshot struct {
    DBPassword []byte
    HMACKeys   []VersionedKey
    TLSBundle  TLSBundle
}

type Holder struct {
    v atomic.Value // stores *SecretsSnapshot
}

func (h *Holder) Load() *SecretsSnapshot {
    s, _ := h.v.Load().(*SecretsSnapshot)
    return s
}

func (h *Holder) Store(s *SecretsSnapshot) {
    h.v.Store(s)
}
```

Reload flow:

```text
fetch all required new secret values
validate format
validate semantic compatibility
create immutable snapshot
swap atomically
close/recreate dependent clients if needed
emit safe audit/metric event
```

Do not swap one secret at a time if they are correlated.

---

## 16. Database Credential Rotation in Go

Database credentials have an additional problem: `database/sql` connection pools keep established connections.

### 16.1 Rotation hazard

If password rotates, existing connections may continue working until closed, but new connections with old password may fail. Or downstream may kill old sessions immediately.

### 16.2 Safer pattern

```mermaid
sequenceDiagram
    participant SM as Secret Manager
    participant App as Go App
    participant Pool as database/sql Pool
    participant DB as Database

    SM->>DB: create/activate new credential
    SM->>App: new secret version available
    App->>App: build new DSN
    App->>DB: ping with new credential
    App->>Pool: swap pool/client atomically
    App->>Pool: drain old pool gradually
    SM->>DB: revoke old credential after overlap
```

### 16.3 Dual pool wrapper sketch

```go
package dbcred

import (
    "context"
    "database/sql"
    "sync/atomic"
    "time"
)

type DBHolder struct {
    current atomic.Pointer[sql.DB]
}

func (h *DBHolder) DB() *sql.DB {
    return h.current.Load()
}

func (h *DBHolder) Swap(newDB *sql.DB, oldDrain time.Duration) {
    old := h.current.Swap(newDB)
    if old != nil {
        go func() {
            time.Sleep(oldDrain)
            _ = old.Close()
        }()
    }
}

func BuildAndVerify(ctx context.Context, driver, dsn string) (*sql.DB, error) {
    db, err := sql.Open(driver, dsn)
    if err != nil {
        return nil, err
    }
    if err := db.PingContext(ctx); err != nil {
        _ = db.Close()
        return nil, err
    }
    return db, nil
}
```

Production details:

- cap old pool lifetime;
- reduce `ConnMaxLifetime` around rotation;
- monitor auth failures;
- support alternating users where possible;
- never log DSN with password;
- run migration/admin tasks with separate credentials.

---

## 17. Secret Logging and Redaction

### 17.1 Redaction boundary

Never rely only on “developers remember not to log secret”. Build types and helpers that make leakage harder.

Bad:

```go
slog.Info("loaded config", "config", cfg)
```

Better:

```go
slog.Info("loaded secret", 
    "secret_class", "db_password",
    "provider", "aws_secrets_manager",
    "version", safeVersionHash(version),
)
```

### 17.2 Safe version hash

Sometimes you need to know whether all instances use same version without exposing version name.

```go
func SafeFingerprint(v string) string {
    sum := sha256.Sum256([]byte(v))
    return hex.EncodeToString(sum[:8])
}
```

Only use this for non-secret metadata. Do **not** hash secret values and log the digest unless you have a deliberate risk decision; low-entropy secrets can be guessed offline.

### 17.3 Redaction test

```go
func TestSecretDoesNotFormatValue(t *testing.T) {
    s := secrets.NewRedactedBytes([]byte("super-secret"))

    got := fmt.Sprintf("%v %#v %s", s, s, s)
    if strings.Contains(got, "super-secret") {
        t.Fatal("secret leaked via formatting")
    }
}
```

---

## 18. Secrets in Memory: Be Honest About Go

Go is garbage-collected. You have limited control over memory lifetime.

Important realities:

1. strings are immutable and may be copied;
2. byte slices can be overwritten, but copies may exist;
3. compiler/runtime can move or copy data;
4. logs/panic/heap profiles can expose data;
5. zeroing a slice is useful hygiene but not a formal guarantee;
6. avoid bringing high-value private keys into app memory if KMS/HSM/Vault transit can perform operation externally.

### 18.1 Prefer `[]byte` for secret values that must be wiped best-effort

```go
func Wipe(b []byte) {
    for i := range b {
        b[i] = 0
    }
}
```

Use carefully:

```go
secret, err := provider.Get(ctx, name)
if err != nil { return err }
defer Wipe(secret.Value)
```

Caveat: copies may already exist. This is not equivalent to secure memory.

### 18.2 Avoid converting to string unnecessarily

```go
// Avoid
password := string(secretBytes)
```

Many APIs require string. If unavoidable, minimize scope and never log.

### 18.3 Reduce dump exposure

Production control:

- disable public pprof;
- restrict debug endpoints;
- avoid heap dump in prod unless controlled;
- configure core dump policy;
- avoid logging full config;
- sanitize panic recovery;
- restrict `kubectl exec`/ephemeral containers;
- avoid shell in production images.

---

## 19. Blast-Radius Design

Secret management is mostly blast-radius engineering.

### 19.1 Scope dimensions

A good secret is scoped by:

| Dimension | Example |
|---|---|
| environment | dev/UAT/prod separate |
| service | payment-api only |
| tenant | tenant-specific key if needed |
| action | read-only vs write vs admin |
| resource | one database/schema/bucket/topic |
| time | expires/rotates/lease TTL |
| network | source VPC/pod/workload identity |
| crypto purpose | signing vs encryption vs MAC |
| region | region-local secret/key |
| deployment unit | per workload identity/service account |

### 19.2 Bad blast radius

```text
prod/shared/admin/password
```

Used by:

- reporting;
- case management;
- batch jobs;
- API;
- data migration;
- support tool.

If leaked, attacker owns everything.

### 19.3 Better blast radius

```text
prod/aceas/case-api/db/readwrite
prod/aceas/report-api/db/readonly
prod/aceas/cft-worker/s3/write-only
prod/aceas/audit-export/hmac/signing/2026-06
```

Each secret has:

- distinct IAM/Vault policy;
- distinct audit;
- distinct rotation;
- distinct owner;
- limited downstream privileges.

### 19.4 Mermaid: blast radius comparison

```mermaid
flowchart TD
    subgraph Bad[Shared Credential]
        S[shared-admin-secret] --> A[API]
        S --> B[Batch]
        S --> C[Report]
        S --> D[Support Tool]
        S --> E[Migration]
    end

    subgraph Good[Scoped Credentials]
        A1[api-rw-secret] --> A2[API]
        B1[batch-job-secret] --> B2[Batch]
        C1[report-ro-secret] --> C2[Report]
        D1[support-limited-secret] --> D2[Support Tool]
        E1[migration-timeboxed-secret] --> E2[Migration]
    end
```

---

## 20. Secret Naming and Metadata

Secret names are not necessarily secret, but can reveal architecture.

Bad:

```text
prod/root-oracle-password-for-regulator-case-db
```

Better:

```text
/prod/aceas/case-api/db/primary
```

Metadata to track:

```yaml
name: /prod/aceas/case-api/db/primary
owner: team-case-platform
consumer: case-api
provider: aws-secrets-manager
classification: credential.database
privilege: readwrite.case_schema_only
rotation:
  mode: alternating-user
  max_age: 30d
  overlap: 2h
blast_radius:
  environment: prod
  service: case-api
  database: case_db
  schema: case_app
incident:
  revoke_playbook: IR-SEC-DB-CRED-001
```

---

## 21. Build, CI/CD, and Secret Leakage

Secrets often leak before runtime.

### 21.1 CI/CD risk points

- build logs;
- test logs;
- `go test -v` output;
- integration test DSN;
- Docker build args;
- GitHub Actions artifacts;
- cache layers;
- Terraform plan output;
- Helm rendered manifests;
- crash dumps;
- dependency scanner uploads;
- AI coding assistant prompt/context;
- screenshots attached to tickets.

### 21.2 Build-time rule

Do not pass production secrets at build time.

Bad:

```dockerfile
ARG DB_PASSWORD
RUN echo $DB_PASSWORD > /app/password.txt
```

Good:

```text
build produces generic artifact
runtime identity retrieves secret
```

### 21.3 Secret scanning

Use secret scanning in:

- pre-commit;
- pull request;
- CI;
- repository history scanning;
- artifact scanning;
- container image scanning;
- IaC scanning.

If a secret lands in Git history, deleting the line in a later commit is insufficient. Rotate/revoke.

---

## 22. Local Development Without Poisoning Production

Local development needs convenience, but must not train unsafe habits.

### 22.1 Good local pattern

```text
.env.example          committed, no real secrets
.env.local            ignored, dev-only values
localstack/minio/dev  disposable credentials
```

### 22.2 Guardrails

At startup:

```go
if env == "prod" && strings.Contains(dbHost, "localhost") {
    return errors.New("refusing prod with localhost database")
}
if env == "prod" && strings.Contains(password, "dev") {
    return errors.New("refusing prod with dev-looking password")
}
```

But don't rely on string heuristics as main security control.

### 22.3 Separate dev secrets from prod secrets

No engineer laptop should need production DB password for ordinary development.

If production-like debugging is needed:

- use read-only replica;
- use break-glass workflow;
- audit access;
- time-bound credential;
- masked/tokenized data;
- approval trail.

---

## 23. Designing a Secret Provider Layer for Go Services

A production Go service can standardize secret handling.

```mermaid
flowchart TD
    A[App Code] --> B[Domain Credential Provider]
    B --> C[Secret Cache]
    C --> D[Provider Interface]
    D --> E1[File Provider]
    D --> E2[AWS Secrets Manager Provider]
    D --> E3[AWS SSM Provider]
    D --> E4[Vault Provider]
    D --> E5[Test Provider]
    C --> F[Metrics + Audit Safe Events]
    C --> G[Redaction Layer]
```

### 23.1 Interface design

```go
type Provider interface {
    Get(ctx context.Context, name Name) (Secret, error)
}

type Watcher interface {
    Watch(ctx context.Context, name Name) (<-chan Event, error)
}

type Event struct {
    Name    Name
    Version Version
    Time    time.Time
}
```

### 23.2 Domain-specific providers

```go
type WebhookKeys struct {
    Current  VersionedKey
    Previous []VersionedKey
}

type WebhookKeyProvider interface {
    Keys(ctx context.Context) (WebhookKeys, error)
}
```

This avoids business logic knowing raw secret store names.

### 23.3 Validation before exposure

```go
func ParseHMACKey(s Secret) (VersionedKey, error) {
    if len(s.Value) < 32 {
        return VersionedKey{}, errors.New("hmac key too short")
    }
    return VersionedKey{Version: s.Version, Key: cloneBytes(s.Value)}, nil
}
```

Do not let invalid secret poison runtime snapshot.

---

## 24. Secret Store Outage Strategy

If secret provider is down, what should the service do?

### 24.1 Startup

At startup, fail closed for missing required secret.

```text
Required secret unavailable -> startup fails -> orchestration retries -> alert
```

Exception: local dev/test with explicit mode.

### 24.2 Runtime refresh

At runtime:

- if old secret still valid and within hard TTL, continue degraded;
- if lease expired, fail closed for operations requiring that credential;
- if provider returns explicit revocation, stop using old secret;
- if new secret invalid, keep old last-known-good until hard TTL;
- alert before TTL exhaustion.

### 24.3 Avoid fail-open fallback

Bad:

```go
if secretProviderFails {
    useDefaultPassword()
}
```

Fallback credentials are production backdoors.

---

## 25. Secrets and Authorization: Reading a Secret Is a Privileged Operation

Treat secret read as sensitive action.

### 25.1 Policy design

Policy must bind:

```text
workload identity -> exact secret path/action -> environment -> audit
```

Example IAM intent:

```text
payment-api-prod role can read only:
  arn:aws:secretsmanager:region:acct:secret:/prod/payment-api/*

It cannot read:
  /prod/reporting/*
  /uat/payment-api/*
  /prod/admin/*
```

### 25.2 Kubernetes service account boundary

Do not reuse one service account across many apps.

```yaml
serviceAccountName: payment-api
```

Not:

```yaml
serviceAccountName: default
```

### 25.3 Human access

Human access to prod secrets should be exceptional:

- approval;
- time-bound;
- reason;
- ticket;
- read-only if possible;
- audited;
- automatically revoked.

A mature system should minimize human secret reading entirely.

---

## 26. Secret Expiry and Time

Secrets should have explicit time semantics.

```go
type Secret struct {
    Value     []byte
    Version   string
    NotBefore time.Time
    NotAfter  time.Time
    LeaseID   string
    Renewable bool
}
```

### 26.1 Clock issues

Rotation and expiry depend on clocks. Consider:

- clock skew;
- monotonic time for local durations;
- UTC for metadata;
- grace window;
- NTP failure;
- regional latency.

### 26.2 Expiry policy

```text
hard_expiry = provider_expiry - safety_margin
refresh_at = now + ttl * 2/3 + jitter
```

Use jitter to avoid all replicas refreshing at same time.

---

## 27. Secrets and Multi-Tenant Systems

In multi-tenant systems, one secret per entire platform may violate blast-radius goals.

### 27.1 Options

| Model | Pros | Cons |
|---|---|---|
| platform-wide key | simple | huge blast radius |
| per-service key | manageable | tenant compromise impact still broad within service |
| per-tenant key | better isolation | key count/rotation complexity |
| per-tenant-per-purpose key | strongest isolation | high operational maturity needed |

### 27.2 Tenant-aware AAD

For encryption/MAC, bind tenant/resource metadata into AAD/context.

```text
AAD = service || env || tenant_id || purpose || schema_version
```

This prevents ciphertext/MAC replay across tenants or contexts.

---

## 28. Secrets and Regulatory Defensibility

For regulated systems, you need evidence.

Evidence questions:

1. Which secrets exist?
2. Who owns each secret?
3. Which workloads can read it?
4. When was it last rotated?
5. Who read it recently?
6. What system produced it?
7. What downstream authority does it grant?
8. Is there a revoke playbook?
9. What is the maximum blast radius?
10. How do we prove it was not logged?

### 28.1 Secret inventory table

| Field | Example |
|---|---|
| secret_id | `/prod/aceas/case-api/db/primary` |
| owner | `case-platform-team` |
| consumer | `case-api` |
| provider | `aws-secrets-manager` |
| type | `database-credential` |
| privilege | `case_schema_readwrite` |
| rotation_frequency | `30d` |
| last_rotated | `2026-06-01T00:00:00Z` |
| expiry | `N/A` or timestamp |
| break_glass | `IR-SEC-001` |
| audit_source | `CloudTrail/Vault audit/K8s audit` |

---

## 29. Kubernetes + External Secret Architecture

Common architecture:

```mermaid
flowchart LR
    A[AWS Secrets Manager / Vault] --> B[External Secrets Operator / CSI Driver / Agent]
    B --> C[Kubernetes Secret or Mounted Volume]
    C --> D[Go Pod]
    D --> E[Runtime Secret Cache]
```

Risk tradeoff:

| Pattern | Risk |
|---|---|
| sync to Kubernetes Secret | secret copied into etcd; RBAC becomes critical |
| mount via CSI | less persistence in K8s API object, but node/plugin trust matters |
| Vault Agent template | good lease support, but app reload needed |
| app direct to provider | app owns complexity and provider dependency |

No pattern is universally best.

Decision depends on:

- rotation frequency;
- lease semantics;
- team maturity;
- incident needs;
- existing platform controls;
- compliance requirements;
- service count;
- availability dependency tolerance.

---

## 30. Secrets and Observability

### 30.1 What to log

Safe:

```text
secret class
provider name
operation type
success/failure
latency bucket
version fingerprint of metadata
lease expiry bucket
reload result
reason category
```

Unsafe:

```text
secret value
full DSN
Authorization header
Cookie header
private key
Vault token
raw AWS credentials
full secret path if it reveals sensitive customer/system details
```

### 30.2 Metrics

```text
secret_provider_request_total{provider,operation,result}
secret_provider_latency_seconds{provider,operation}
secret_reload_total{secret_class,result}
secret_cache_age_seconds{secret_class}
secret_lease_seconds_remaining{secret_class}
secret_rotation_old_version_use_total{secret_class}
secret_redaction_violation_total{source}
```

### 30.3 Alerts

Alert when:

- secret cannot refresh;
- hard TTL near expiry;
- old version still used after rotation window;
- auth failures spike after rotation;
- secret provider latency/error spikes;
- unexpected principal reads secret;
- human accesses prod secret;
- secret scanner finds credential in repo/log/artifact.

---

## 31. Testing Strategy

### 31.1 Unit tests

Test:

- missing secret;
- empty secret;
- malformed secret;
- too-short key;
- expired secret;
- cache hit/miss;
- provider failure;
- redaction;
- reload atomicity;
- previous/current key verify behavior;
- no secret in error string.

### 31.2 Integration tests

Test with local fake provider or real dev provider:

- provider timeout;
- rotation event;
- invalid version;
- old version retained;
- revoke event;
- downstream credential swap;
- database pool recreation;
- file mount update.

### 31.3 Leak tests

Search logs/test output:

```go
func TestNoSecretLeakInLogs(t *testing.T) {
    secret := "this-secret-must-not-appear"
    logs := runScenarioAndCaptureLogs(secret)
    if strings.Contains(logs, secret) {
        t.Fatal("secret leaked to logs")
    }
}
```

### 31.4 Chaos tests

Inject:

- secret provider unavailable;
- high latency;
- stale version;
- permission denied;
- malformed JSON secret;
- rotated DB credential;
- revoked old credential;
- file update while requests active;
- all replicas refresh simultaneously.

---

## 32. Example: Webhook HMAC Secret Rotation

### 32.1 Requirements

- provider sends HMAC signature;
- old and new secret must overlap for 24 hours;
- service must verify old and new;
- outbound/admin UI displays only version fingerprint;
- secret never logged.

### 32.2 Data model

```go
type VersionedKey struct {
    Kid       string
    Key       []byte
    NotBefore time.Time
    NotAfter  time.Time
}

type WebhookKeySet struct {
    Current  VersionedKey
    Previous []VersionedKey
}
```

### 32.3 Verification flow

```mermaid
flowchart TD
    A[Receive webhook] --> B[Read signature headers]
    B --> C[Build canonical message]
    C --> D[Load current keyset snapshot]
    D --> E[Try key by kid if present]
    E --> F{Valid?}
    F -->|yes| G[Accept + audit key version fingerprint]
    F -->|no| H[Try previous keys within overlap]
    H --> I{Valid?}
    I -->|yes| J[Accept + metric old-key-used]
    I -->|no| K[Reject 401/403]
```

### 32.4 Verification sketch

```go
func VerifyWebhook(msg, sig []byte, keys WebhookKeySet, now time.Time) bool {
    all := append([]VersionedKey{keys.Current}, keys.Previous...)
    for _, k := range all {
        if !k.NotBefore.IsZero() && now.Before(k.NotBefore) {
            continue
        }
        if !k.NotAfter.IsZero() && now.After(k.NotAfter) {
            continue
        }
        mac := hmac.New(sha256.New, k.Key)
        mac.Write(msg)
        expected := mac.Sum(nil)
        if hmac.Equal(expected, sig) {
            return true
        }
    }
    return false
}
```

Do not log `msg` if it may contain sensitive payload.

---

## 33. Example: AWS Secrets Manager Provider Shape

This is architectural shape, not full AWS SDK tutorial.

```go
type AWSSecretsManagerProvider struct {
    client SecretsManagerClient
}

type SecretsManagerClient interface {
    GetSecretValue(ctx context.Context, secretID string) (value []byte, version string, err error)
}

func (p *AWSSecretsManagerProvider) Get(ctx context.Context, name secrets.Name) (secrets.Secret, error) {
    value, version, err := p.client.GetSecretValue(ctx, string(name))
    if err != nil {
        return secrets.Secret{}, fmt.Errorf("get secret value: %w", err)
    }
    if len(value) == 0 {
        return secrets.Secret{}, errors.New("secret value is empty")
    }
    if len(value) > 64*1024 {
        return secrets.Secret{}, errors.New("secret value too large")
    }
    return secrets.Secret{
        Name:    name,
        Version: secrets.Version(version),
        Value:   cloneBytes(value),
    }, nil
}
```

Important boundaries:

- AWS IAM role must restrict exact secret ARNs;
- do not include secret value in error;
- set request timeout;
- cache responsibly;
- use retries with jitter;
- monitor `AccessDenied`, throttling, timeout;
- avoid secret fetch on every request.

---

## 34. Example: File Provider Shape

```go
type FileProvider struct {
    BaseDir string
    Mapping map[secrets.Name]string
}

func (p *FileProvider) Get(ctx context.Context, name secrets.Name) (secrets.Secret, error) {
    rel, ok := p.Mapping[name]
    if !ok {
        return secrets.Secret{}, fmt.Errorf("secret not mapped: %s", name)
    }
    if strings.Contains(rel, "..") || strings.HasPrefix(rel, "/") {
        return secrets.Secret{}, errors.New("invalid secret relative path")
    }

    path := filepath.Join(p.BaseDir, rel)
    b, err := ReadSecretFile(path)
    if err != nil {
        return secrets.Secret{}, err
    }
    return secrets.Secret{Name: name, Value: b}, nil
}
```

For Go 1.24+, consider `os.Root` / `OpenInRoot` style APIs where applicable to reduce traversal/symlink escape risk, as covered in Part 025.

---

## 35. Secret Incident Response

When a secret leaks, do not merely delete the leaked copy.

### 35.1 Response sequence

```mermaid
flowchart TD
    A[Secret leak detected] --> B[Classify secret type and authority]
    B --> C[Identify consumers and downstream resources]
    C --> D[Revoke/disable old secret]
    C --> E[Provision new secret]
    E --> F[Reload/redeploy consumers]
    F --> G[Verify auth success with new secret]
    D --> H[Investigate access logs]
    H --> I[Search logs/artifacts/repos/images]
    I --> J[Patch leak source]
    J --> K[Post-incident hardening]
```

### 35.2 Incident checklist

- What secret leaked?
- Was it active?
- What privilege did it grant?
- Which environment?
- Which service/tenant/resource?
- When was it created?
- When was it last used?
- Who/what accessed it after leak time?
- Can downstream logs confirm abuse?
- Was it in source history/container image/log artifact?
- Has it been revoked?
- Have all consumers moved to new version?
- Has secret scanner been updated?
- Was root cause code/process fixed?

---

## 36. Review Checklist

### 36.1 Design review

- [ ] Every secret has owner, consumer, provider, privilege, environment, and rotation plan.
- [ ] Secret is scoped per service/environment/resource.
- [ ] No shared admin credential across services.
- [ ] Rotation does not require source code change.
- [ ] Secret reload behavior is defined.
- [ ] Provider outage behavior is defined.
- [ ] Revocation behavior is defined.
- [ ] Secret store access is least privilege.
- [ ] Human access is exceptional and audited.
- [ ] Secret values are never logged, traced, or returned.
- [ ] Secret values are not stored in image layers.
- [ ] Secret values are not present in IaC manifests committed to Git.
- [ ] Secret versioning is supported where rotation overlap matters.
- [ ] Old versions have retirement policy.
- [ ] Audit events exist for secret read/rotate/revoke.

### 36.2 Go code review

- [ ] No hard-coded secrets.
- [ ] No fallback production default secret.
- [ ] No `fmt.Printf("%+v", cfg)` containing secret.
- [ ] `os.Getenv` is not scattered in business code.
- [ ] Secret provider has timeout.
- [ ] Secret cache has TTL/hard expiry.
- [ ] Secret reload validates before swap.
- [ ] Secret snapshot swap is atomic.
- [ ] Errors do not contain secret values.
- [ ] DSNs are redacted before logging.
- [ ] Tests assert no secret leakage in logs.
- [ ] High-value private keys are preferably not loaded into app memory.

### 36.3 Kubernetes review

- [ ] Encryption at rest enabled for Secrets.
- [ ] RBAC restricts get/list/watch Secrets.
- [ ] App service account is per service.
- [ ] Users who can create Pods are considered able to exfiltrate namespace Secrets unless constrained.
- [ ] Secret manifests with real values are not committed.
- [ ] Secret volume mount is preferred over env var for reloadable secrets.
- [ ] External secret provider/CSI/agent is considered for high-value secrets.
- [ ] Audit alerts exist for unusual secret reads.

### 36.4 AWS/Vault review

- [ ] IAM/Vault policy scopes exact secret paths.
- [ ] No broad wildcard unless justified.
- [ ] Rotation strategy documented.
- [ ] Dynamic secrets use lease TTL and renewal/revocation handling.
- [ ] CloudTrail/Vault audit logs monitored.
- [ ] Provider errors alert before expiry.
- [ ] Break-glass process exists.

---

## 37. Engineering Heuristics

### 37.1 Prefer identity over shared secret

If the platform supports workload identity, IAM role, mTLS/SPIFFE, or database IAM authentication, prefer that over distributing long-lived shared passwords.

### 37.2 Prefer short-lived over long-lived

Short-lived dynamic secret reduces damage window.

### 37.3 Prefer scoped over global

A narrowly scoped secret makes incident response possible.

### 37.4 Prefer external operation for high-value keys

If a key signs tokens, decrypts data, or protects many tenants, prefer KMS/HSM/Vault transit so the app invokes an operation rather than receives raw key material.

### 37.5 Prefer versioned over anonymous

A secret without version metadata is hard to rotate safely.

### 37.6 Prefer atomic snapshot over mutable globals

Partial reload is an outage and security bug.

### 37.7 Prefer deny-by-default on missing secret

A missing secret should not silently turn off auth, encryption, or verification.

---

## 38. Java-to-Go Security Mindset Shift

As a Java engineer, you may be used to frameworks like Spring Boot externalized config, Vault integration, Kubernetes config binding, and dependency-injected credential beans.

In Go, the ecosystem is usually more explicit:

| Java/Spring habit | Go equivalent mindset |
|---|---|
| `@Value("${secret}")` injection | explicit config + provider boundary |
| Spring Cloud Vault | explicit Vault/agent/provider design |
| `DataSource` managed by framework | `database/sql` pool lifecycle must be controlled |
| global config bean | immutable config snapshot and atomic swap |
| logging framework masking | build redaction types and slog handlers deliberately |
| secret reload via actuator/cloud config | implement reload state machine or sidecar/file watcher |

Go gives fewer “magic rails”. That is good for auditability, but only if you design the rails yourself.

---

## 39. Mini Capstone: Production Secret Flow for a Go API

Scenario:

```text
case-api needs:
- DB read/write credential
- outbound document service API token
- inbound webhook HMAC verification keys
- TLS client certificate for mTLS to internal service
```

### 39.1 Proposed architecture

```mermaid
flowchart TD
    A[Workload Identity / IAM Role / SA] --> B[Secret Provider]
    B --> C1[DB Credential Secret]
    B --> C2[Document API Token]
    B --> C3[Webhook HMAC Keyset]
    B --> C4[mTLS Cert/Key Files]

    C1 --> D[Secret Cache + DB Pool Manager]
    C2 --> E[Outbound Client Token Provider]
    C3 --> F[Webhook Verifier Snapshot]
    C4 --> G[TLS Config Reloader]

    D --> H[case-api runtime]
    E --> H
    F --> H
    G --> H

    H --> I[Safe Logs/Metrics/Audit]
```

### 39.2 Secret-specific behavior

| Secret | Delivery | Rotation |
|---|---|---|
| DB credential | Secrets Manager/Vault dynamic; app cache | verify new pool, swap, drain old |
| Document API token | Secrets Manager/SSM; cached | reload and retry bounded on auth failure |
| Webhook HMAC keys | versioned keyset | accept old+new during overlap |
| mTLS cert/key | file-mounted cert-manager/SPIRE | `GetCertificate`/`GetClientCertificate` reload |

### 39.3 Required controls

- secret store IAM/Vault policy per service;
- provider request timeout;
- cache TTL;
- atomic reload;
- redacted logs;
- alert before expiry;
- no secret env var for reloadable material;
- secret scanner in CI;
- incident revoke playbook.

---

## 40. What This Part Enables

Setelah part ini, Anda harus bisa:

1. membedakan config, secret, credential, token, key, certificate, dan trust anchor;
2. mendesain flow secret dari source-of-truth sampai Go process;
3. menentukan kapan env var acceptable dan kapan harus file/provider;
4. memilih antara Kubernetes Secret, SSM Parameter Store, Secrets Manager, Vault, KMS, dan external secret pattern;
5. membuat reload/rotation state machine;
6. mendesain secret cache dengan TTL/hard expiry;
7. membatasi blast radius secret;
8. membuat checklist design review dan code review untuk secrets management;
9. menjelaskan kenapa secret store bukan otomatis secret management;
10. membuat Go service lebih defensible saat audit dan incident response.

---

## 41. References

Referensi utama yang relevan untuk part ini:

1. Go `os` package documentation — `Getenv`, `LookupEnv`, process/environment APIs.  
   `https://pkg.go.dev/os`
2. Go 1.26 Release Notes — `crypto/fips140`, security/runtime changes.  
   `https://go.dev/doc/go1.26`
3. Go FIPS 140-3 documentation.  
   `https://go.dev/doc/security/fips140`
4. Kubernetes Secrets documentation.  
   `https://kubernetes.io/docs/concepts/configuration/secret/`
5. Kubernetes Good practices for Secrets.  
   `https://kubernetes.io/docs/concepts/security/secrets-good-practices/`
6. AWS Systems Manager Parameter Store documentation.  
   `https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html`
7. AWS Systems Manager SecureString and KMS encryption.  
   `https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html`
8. AWS Secrets Manager best practices.  
   `https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html`
9. AWS Secrets Manager rotation.  
   `https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html`
10. HashiCorp Vault — Lease, renew, revoke.  
   `https://developer.hashicorp.com/vault/docs/concepts/lease`
11. HashiCorp Vault — Static and dynamic secrets.  
   `https://developer.hashicorp.com/vault/tutorials/get-started/understand-static-dynamic-secrets`
12. NIST SP 800-57 Part 1 Rev. 5 — Recommendation for Key Management.  
   `https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final`

---

## 42. Next Part

Part berikutnya:

```text
learn-go-security-cryptography-integrity-part-030.md
```

Topik:

```text
Privacy and Sensitive Data Handling:
PII classification, tokenization, encryption at rest, field-level encryption, masking, logs, telemetry, and data minimization.
```

Seri belum selesai. Lanjut ke part 030.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-go-security-cryptography-integrity-part-028.md">⬅️ Secure Audit Logging in Go: Correlation ID, Actor Identity, Event Schema, Redaction, Immutability, Retention, and Legal Defensibility</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../index.md">🏠 Home</a>
<a href="./learn-go-security-cryptography-integrity-part-030.md">Privacy and Sensitive Data Handling in Go ➡️</a>
</div>
