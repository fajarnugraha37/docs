# learn-java-eclipse-jersey-deployment-models-part-025  
# Part 25 — Deployment-Time Configuration Architecture

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 25 dari 32**  
> Target pembaca: engineer Java backend yang ingin mendesain konfigurasi deployment Jersey secara aman, typed, tervalidasi, repeatable, dan portable lintas runtime.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: environment variables, config files, server config, MicroProfile Config, Kubernetes ConfigMap/Secret, Docker secrets, config precedence, validation, typed configuration, reload-vs-restart, secret handling, config drift, dan production safety.

---

## 1. Mengapa Configuration Architecture Penting?

Banyak production incident bukan karena kode bisnis salah, tetapi karena konfigurasi deployment salah.

Contoh:

```text
DB URL salah environment
timeout terlalu panjang
Jersey context path beda dari Ingress
feature Open Liberty belum di-enable
Payara JDBC resource belum dibuat
Tomcat maxThreads terlalu besar
JWT issuer salah
CORS origin wildcard di PROD
Redis host menunjuk DEV
body size limit beda antara nginx dan app
JAVA_OPTS hilang
secret accidentally baked into image
```

Configuration architecture menjawab:

```text
Nilai config berasal dari mana?
Siapa yang boleh mengubah?
Mana default, mana override?
Bagaimana validasi dilakukan?
Apakah secret aman?
Apakah perubahan butuh restart?
Bagaimana audit config efektif?
Bagaimana mencegah DEV config masuk PROD?
```

Top-tier mental model:

> Configuration is runtime code.  
> Jika config salah, behavior runtime salah, walaupun source code benar.

---

## 2. Apa Itu Deployment-Time Configuration?

Deployment-time configuration adalah nilai yang ditentukan ketika aplikasi dideploy atau dijalankan, bukan ketika source code ditulis.

Examples:

```text
server port
bind host
context path
database URL
database pool size
JDBC resource name
HTTP client timeout
downstream base URL
feature flags
CORS allowed origins
JWT issuer/audience
TLS truststore path
log level
request body limit
thread pool size
cache TTL
rate limit
public base URL
```

Bukan deployment-time config:

```text
business rule yang harus versioned dengan kode
database schema migration
domain invariant
API contract
security algorithm policy yang harus dikontrol governance
```

Boundary penting:

```text
Config should change behavior within designed limits.
Config should not turn the app into a different product.
```

---

## 3. Configuration Source Types

Common sources:

```text
packaged defaults
external property file
YAML/JSON/HOCON/TOML file
environment variables
system properties
command-line args
Kubernetes ConfigMap
Kubernetes Secret
Docker secrets
server.xml / domain.xml / server config
JNDI resource
MicroProfile Config sources
cloud secret manager
database config table
feature flag service
```

Each has trade-off.

| Source | Good For | Risk |
|---|---|---|
| Packaged defaults | safe baseline | accidentally production default |
| Env vars | simple container config | type/secret leakage |
| Config files | structured config | mount/reload complexity |
| System properties | JVM/app flags | command-line exposure |
| ConfigMap | non-secret K8s config | restart/reload semantics |
| Secret | sensitive values | RBAC/etcd/log leakage |
| Server config | app-server resources | environment drift |
| Secret manager | strong secret governance | dependency/startup complexity |
| DB config table | dynamic business settings | bootstrapping/audit complexity |

---

## 4. Configuration Precedence

When same key exists in multiple sources, which wins?

Without explicit precedence, debugging becomes painful.

Example precedence:

```text
1. command-line system properties
2. environment variables
3. external mounted config file
4. server config/JNDI
5. packaged application defaults
```

MicroProfile Config formalizes this idea using ConfigSources and ordinals. MicroProfile Config describes configuration sources from different locations and applies policy when the same property is defined multiple times.

Common default MicroProfile Config source ordinals include:

```text
System properties:
  high priority

Environment variables:
  high priority

microprofile-config.properties:
  packaged/default lower priority
```

The exact version/runtime may differ, but the principle is:

```text
external deployment config overrides packaged defaults.
```

Document your precedence.

---

## 5. Why “Profiles” Are Dangerous

Common pattern:

```text
application-dev.properties
application-uat.properties
application-prod.properties
```

This can be useful, but dangerous.

Risks:

```text
different keys per environment
prod value committed
DEV behavior differs structurally from PROD
profile accidentally set wrong
hidden defaults
copy-paste drift
```

Better pattern:

```text
same config schema across environments
different values injected by environment
```

Example:

```text
application.properties:
  app.port=${APP_PORT}
  db.url=${DB_URL}
  db.pool.max=${DB_POOL_MAX}
```

Then DEV/UAT/PROD provide values externally.

Rule:

```text
Profiles should select small behavior sets, not carry entire environment truth.
```

---

## 6. Config Schema

Every production service needs a config schema.

Schema defines:

```text
key name
type
required/optional
default
allowed values
min/max
unit
secret/non-secret
reloadable/not reloadable
description
example
owner
```

Example:

| Key | Type | Required | Default | Unit | Secret | Reloadable |
|---|---|---:|---|---|---:|---:|
| `APP_PORT` | int | yes | none | port | no | no |
| `DB_URL` | string | yes | none | URL | no-ish | no |
| `DB_PASSWORD` | secret | yes | none | secret | yes | no |
| `HTTP_CLIENT_TIMEOUT_MS` | int | yes | 2000 | ms | no | no |
| `CORS_ALLOWED_ORIGINS` | list | yes | none | URL list | no | restart |
| `LOG_LEVEL` | enum | no | INFO | enum | no | maybe |
| `FEATURE_X_ENABLED` | boolean | no | false | boolean | no | maybe |

If config is not documented, it will drift.

---

## 7. Typed Configuration

Avoid raw string config scattered everywhere.

Bad:

```java
String timeout = System.getenv("TIMEOUT");
int t = Integer.parseInt(timeout);
```

repeated in many classes.

Better:

```java
public record HttpClientConfig(
    URI baseUri,
    Duration connectTimeout,
    Duration readTimeout,
    int maxConnections
) {
    public HttpClientConfig {
        Objects.requireNonNull(baseUri);
        Objects.requireNonNull(connectTimeout);
        Objects.requireNonNull(readTimeout);

        if (connectTimeout.isNegative() || connectTimeout.isZero()) {
            throw new IllegalArgumentException("connectTimeout must be positive");
        }

        if (maxConnections <= 0) {
            throw new IllegalArgumentException("maxConnections must be positive");
        }
    }
}
```

Then build once:

```java
HttpClientConfig config = ConfigLoader.loadHttpClientConfig("documentService");
```

Typed config gives:

- validation,
- central defaults,
- better tests,
- better diagnostics,
- fewer parsing bugs.

---

## 8. Fail Fast Configuration

If required config missing, fail startup.

Bad:

```text
application starts
first user request fails because DB_URL missing
```

Good:

```text
startup fails
pod not ready
deployment blocked
logs show missing key
```

Example:

```java
public final class RequiredConfig {

    public static String requiredEnv(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing required environment variable: " + name);
        }
        return value;
    }
}
```

Do not default critical config to unsafe values.

Bad:

```java
String dbUrl = envOrDefault("DB_URL", "jdbc:postgresql://localhost/dev");
```

in production code.

---

## 9. Config Validation Categories

Validate:

```text
presence:
  required key exists

type:
  integer, boolean, duration, URI, enum

range:
  pool max > 0, timeout > 0

relation:
  min <= max, request timeout < gateway timeout

environment:
  PROD cannot use localhost/DEV URL

security:
  CORS wildcard forbidden with credentials

dependency:
  if feature enabled, required downstream URL exists

filesystem:
  configured file exists and readable

network:
  optional startup connectivity test if appropriate
```

Validation should happen before readiness becomes true.

---

## 10. Safe Defaults vs Dangerous Defaults

Safe default:

```text
log level INFO
feature disabled
metrics enabled
request body limit conservative
```

Dangerous default:

```text
DB URL localhost
CORS *
JWT validation disabled
TLS verification disabled
admin endpoint enabled
pool max huge
timeout infinite
```

Rule:

```text
If wrong default can cause security or data incident, require explicit value.
```

---

## 11. Secrets Are Not Normal Config

Secrets include:

```text
DB password
API key
JWT signing key
private key
client secret
SMTP password
cloud credentials
encryption key
truststore password
```

Secrets require:

- access control,
- audit,
- rotation,
- no logging,
- no committing,
- no image baking,
- no accidental exposure through `/config` endpoint,
- no stack traces with values.

Docker documentation notes that Docker secrets intentionally do not set environment variables directly because environment variables can unintentionally leak.

This reinforces the point:

```text
Secrets should be handled differently from ordinary config.
```

---

## 12. Environment Variables

Kubernetes docs state Pods can consume ConfigMaps as environment variables, command-line arguments, or configuration files mounted as volumes.

Env vars are simple:

```yaml
env:
  - name: APP_PORT
    value: "8080"
  - name: DB_URL
    valueFrom:
      secretKeyRef:
        name: case-api-secret
        key: db-url
```

Pros:

- simple,
- 12-factor friendly,
- easy in Docker/Kubernetes,
- works with MicroProfile Config.

Cons:

- string-only,
- rotation requires restart,
- can leak in diagnostics,
- bad for large structured config,
- bad for certificates/private keys.

Use env vars for simple values.

Use files/secret manager for sensitive structured material.

---

## 13. ConfigMap

Kubernetes ConfigMap stores non-confidential key-value config.

Official Kubernetes documentation says ConfigMaps store non-confidential data in key-value pairs and let you decouple environment-specific configuration from container images.

Example:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: case-api-config
data:
  APP_PORT: "8080"
  LOG_LEVEL: "INFO"
  CORS_ALLOWED_ORIGINS: "https://app.example.com"
```

Use:

```yaml
envFrom:
  - configMapRef:
      name: case-api-config
```

or mounted file:

```yaml
volumeMounts:
  - name: config
    mountPath: /config
volumes:
  - name: config
    configMap:
      name: case-api-config
```

Remember:

```text
ConfigMap is not for secrets.
```

---

## 14. Kubernetes Secret

Secret is for sensitive data, but it is not magic.

Use:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: case-api-secret
type: Opaque
stringData:
  DB_PASSWORD: "change-me"
```

Mount as env:

```yaml
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: case-api-secret
        key: DB_PASSWORD
```

or file.

Security concerns:

```text
RBAC
etcd encryption
audit logging
pod exec access
env dumps
application logs
secret rotation
```

Production may require external secret manager integration.

---

## 15. Mounted Files

Good for:

```text
certificates
private keys
truststore
large structured config
JSON/YAML config
license files
CA bundles
```

Example:

```yaml
volumeMounts:
  - name: tls-secret
    mountPath: /etc/app/tls
    readOnly: true

volumes:
  - name: tls-secret
    secret:
      secretName: case-api-tls
```

Application config:

```text
TLS_KEY_PATH=/etc/app/tls/tls.key
TLS_CERT_PATH=/etc/app/tls/tls.crt
```

Files can be permissioned and rotated more cleanly than env vars, but app reload must be designed.

---

## 16. Command-Line Args and System Properties

System properties:

```bash
java -Dapp.port=8080 -Ddb.url=... -jar app.jar
```

Pros:

- high precedence,
- simple for JVM/app flags,
- visible to Java APIs.

Cons:

- may appear in process listings,
- secrets can leak,
- long command lines,
- harder with complex config.

Use system properties for non-secret runtime switches and JVM/app flags.

Avoid secrets in command-line args.

---

## 17. Server Config

Different deployment modes have server config:

```text
Tomcat:
  server.xml, context.xml, setenv.sh

Jetty:
  JETTY_BASE, modules, XML config

Open Liberty:
  server.xml, server.env, bootstrap.properties

Payara/GlassFish:
  domain.xml, asadmin resources, deployment descriptors

Kubernetes:
  manifests, ConfigMaps, Secrets

Docker:
  env, mounts, entrypoint
```

Server config may define:

- ports,
- thread pools,
- JDBC resources,
- TLS,
- context root,
- feature set,
- logging,
- security realms.

Application config and server config must be coordinated.

---

## 18. Open Liberty Configuration

Open Liberty documentation states the server configuration is made up of one mandatory file, `server.xml`, and optional files.

`server.xml` example:

```xml
<server>
    <featureManager>
        <feature>restfulWS-3.1</feature>
        <feature>cdi-4.0</feature>
        <feature>mpConfig-3.0</feature>
    </featureManager>

    <variable name="http.port" value="${HTTP_PORT}" />

    <httpEndpoint
        id="defaultHttpEndpoint"
        host="*"
        httpPort="${http.port}" />

    <webApplication
        location="case-api.war"
        contextRoot="/case-api" />
</server>
```

In Liberty:

```text
server.xml is part of deployment contract.
```

Version it.

Do not mutate it manually in production without trace.

---

## 19. Payara/GlassFish Configuration

Payara/GlassFish config includes:

```text
domain.xml
JDBC connection pools
JDBC resources
JMS resources
security realms
JVM options
deployment descriptors
asadmin scripts
```

For example:

```text
jdbc/AppDataSource
```

should be provisioned by script/IaC, not manual console memory.

Application should reference stable JNDI name:

```java
@Resource(lookup = "jdbc/AppDataSource")
DataSource dataSource;
```

Environment-specific values live in server resource config.

WAR remains same across environments.

---

## 20. Tomcat Configuration

Tomcat config surfaces:

```text
server.xml
context.xml
web.xml
setenv.sh / setenv.bat
CATALINA_OPTS
JAVA_OPTS
environment variables
```

Typical config:

```text
connector port
maxThreads
acceptCount
RemoteIpValve
context path
JVM memory
logging
```

For Jersey WAR:

```text
web.xml or @ApplicationPath defines REST mapping
Tomcat server config defines connector/proxy/runtime
```

Keep app-specific business config out of Tomcat global config unless ops model requires it.

---

## 21. Jetty Configuration

Jetty config surfaces:

```text
JETTY_HOME
JETTY_BASE
modules
start.d/*.ini
XML context files
webapps directory
environment variables
```

External Jetty should have:

```text
JETTY_BASE versioned
enabled modules documented
context path explicit
thread pool config explicit
```

Do not rely on manual module enablement that differs across environments.

---

## 22. MicroProfile Config

MicroProfile Config aggregates configuration from many `ConfigSource`s into a single merged view.

Example:

```java
@Inject
@ConfigProperty(name = "document.service.base-uri")
URI documentServiceBaseUri;

@Inject
@ConfigProperty(name = "document.service.timeout-ms", defaultValue = "2000")
int timeoutMs;
```

It is strong for:

- Open Liberty,
- Payara/MicroProfile-enabled runtimes,
- portable Jakarta EE/MicroProfile services.

It supports:

- config source precedence,
- injection,
- conversion,
- default values,
- custom config sources,
- typed properties in newer versions/implementations.

But still validate.

Injected config can be syntactically valid but semantically dangerous.

---

## 23. Plain Java Config Loader

If not using MicroProfile Config, write a simple config layer.

Example:

```java
public final class AppConfig {

    private final ServerConfig server;
    private final DatabaseConfig database;
    private final DownstreamConfig documentService;

    public AppConfig(ServerConfig server,
                     DatabaseConfig database,
                     DownstreamConfig documentService) {
        this.server = server;
        this.database = database;
        this.documentService = documentService;
    }

    public void validate() {
        server.validate();
        database.validate();
        documentService.validate();

        if (database.poolMax() > 100) {
            throw new IllegalStateException("DB pool max too high: " + database.poolMax());
        }
    }
}
```

Centralize loading:

```java
AppConfig config = AppConfigLoader.load();
config.validate();
```

Register config as singleton.

Avoid calling `System.getenv()` throughout business code.

---

## 24. Config Immutability

Most deployment config should be immutable after startup.

Why?

- easier reasoning,
- no partial reload bugs,
- same request behavior,
- safer rollback,
- simpler incident diagnosis.

Mutable config is useful for:

- feature flags,
- log level,
- traffic shaping,
- operational kill switches.

But dynamic reload is hard.

Rule:

```text
Default to restart-on-config-change.
Add live reload only where there is strong need and clear safety model.
```

---

## 25. Reload vs Restart

### Restart-on-change

Pros:

- simple,
- predictable,
- works with Kubernetes rolling update,
- easy validation at startup.

Cons:

- slower,
- rollout needed.

### Live reload

Pros:

- fast operational change,
- useful for log levels/feature flags.

Cons:

- race conditions,
- inconsistent in-flight requests,
- partial validation,
- concurrency issues,
- audit complexity,
- secret rotation complexity.

Use live reload only for:

```text
log level
feature flags
rate limit thresholds
non-critical tunables
```

Avoid live reload for:

```text
DB URL
JDBC driver
schema
server port
context path
security issuer
TLS truststore unless explicitly designed
```

---

## 26. Feature Flags

Feature flags are runtime control, but can become chaos.

Good flag:

```text
enable new optional UI field
switch read path after migration
disable non-critical integration
```

Bad flag:

```text
change core authorization semantics
disable audit
turn off validation in PROD
select totally different transaction model
```

Feature flag rules:

```text
owner
default
expiry date
audit
environment value
safe fallback
tests for both states
cleanup plan
```

Stale flags are technical debt.

---

## 27. Config and Security

Config can weaken security.

Dangerous keys:

```text
AUTH_DISABLED
TLS_VERIFY=false
CORS_ALLOWED_ORIGINS=*
JWT_ACCEPT_ANY_ISSUER=true
ENABLE_DEBUG_ENDPOINTS=true
ALLOW_ADMIN_API=true
LOG_REQUEST_BODY=true
```

Production validation should reject unsafe combinations.

Example:

```java
if (env.isProd() && auth.disabled()) {
    throw new IllegalStateException("AUTH_DISABLED is forbidden in PROD");
}
```

Do not rely on humans remembering.

Make unsafe production config impossible.

---

## 28. Public Base URL

Jersey apps behind proxy often need:

```text
PUBLIC_BASE_URL=https://api.example.com/case-api
```

Used for:

- Location headers,
- generated links,
- OpenAPI server URL,
- email links,
- auth callbacks,
- redirects.

Do not build public URL from internal request blindly unless forwarded headers are correctly configured and trusted.

For high-stakes systems, explicit public base URL is safer.

Validation:

```text
must be https in PROD
must not be localhost in PROD
must not end with unexpected slash if code assumes none
```

---

## 29. CORS Configuration

Config:

```text
CORS_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
CORS_ALLOW_CREDENTIALS=true
```

Validation:

```text
if allowCredentials && origins contains "*":
  reject
```

CORS owner should be clear:

```text
proxy/gateway
or application
```

Not both unless coordinated.

---

## 30. Timeout Configuration

Timeout keys should include units.

Bad:

```text
TIMEOUT=5
```

Good:

```text
HTTP_CLIENT_TIMEOUT_MS=5000
```

or ISO/duration format:

```text
DOCUMENT_SERVICE_TIMEOUT=PT5S
```

Validate:

```text
> 0
<= max safe
less than gateway timeout
less than request budget
```

Do not allow infinite/default library timeouts accidentally.

---

## 31. Pool Configuration

DB pool config:

```text
DB_POOL_MAX=20
DB_POOL_CONNECTION_TIMEOUT_MS=250
DB_POOL_IDLE_TIMEOUT_MS=600000
```

Validation:

```text
max > 0
connectionTimeout < requestBudget
poolMax * maxReplicas <= DB budget
```

Some validation requires deployment context:

```text
MAX_REPLICAS
DB_CONNECTION_BUDGET
```

Put those in config or run external policy check.

---

## 32. Environment Identity

Config should know environment:

```text
APP_ENV=dev|uat|prod
```

But do not rely only on `APP_ENV`.

Use it for guardrails:

```text
prod forbids debug
prod requires https public URL
prod requires auth enabled
prod forbids localhost DB
```

Avoid behavior explosion:

```text
if env == dev:
  use entirely different code path
```

Environment should select values, not rewrite application architecture.

---

## 33. Config Drift

Config drift occurs when environments differ unintentionally.

Examples:

```text
DEV has timeout 2s, PROD 30s
UAT has feature enabled, PROD disabled
Payara JDBC pool differs manually
Ingress rewrite differs
Tomcat RemoteIpValve only in PROD
```

Prevent drift:

- version config,
- IaC,
- manifest templates,
- policy validation,
- diff tools,
- release checklists,
- environment promotion,
- config review.

Config should be observable and auditable.

---

## 34. Effective Config Endpoint

Useful internal endpoint:

```text
GET /internal/config/effective
```

But never expose secrets.

Return:

```json
{
  "appEnv": "prod",
  "serverPort": 8080,
  "publicBaseUrl": "https://api.example.com/case-api",
  "dbPoolMax": 20,
  "documentServiceTimeoutMs": 2000,
  "corsAllowedOrigins": ["https://app.example.com"],
  "secrets": {
    "dbPassword": "PRESENT",
    "jwtKey": "PRESENT"
  }
}
```

Security:

```text
internal only
authenticated/authorized
redact secrets
avoid exposing internal topology if sensitive
```

This endpoint is extremely useful during incidents.

---

## 35. Startup Config Log

At startup, log safe config summary:

```text
appName=case-api
version=1.0.0
env=prod
java=21
port=8080
contextRoot=/case-api
publicBaseUrl=https://api.example.com/case-api
dbPoolMax=20
documentServiceBaseUri=https://document.internal
documentServiceTimeoutMs=2000
corsAllowedOrigins=2 values
secrets=dbPassword:PRESENT,jwtKey:PRESENT
```

Do not log secret values.

Do not log complete JWT keys, passwords, tokens.

---

## 36. Config Testing

Test config loading.

Unit test:

```text
missing required key fails
invalid int fails
invalid URI fails
prod localhost URL fails
cors wildcard+credentials fails
timeout too large fails
```

Integration test:

```text
load config from env
load config from file
load MicroProfile Config source
load Kubernetes-like mounted file
```

Deployment test:

```text
container starts with real env template
readiness passes
effective config safe
```

---

## 37. Configuration as Code

Version-control:

```text
Kubernetes manifests
Helm values
Kustomize overlays
Docker Compose
Open Liberty server.xml
Payara asadmin scripts
Tomcat server.xml templates
Jetty base config
Terraform/cloud resources
secret references
policy rules
```

Do not version-control:

```text
actual secret values
manual admin console state
generated local-only files
```

Config-as-code should let you rebuild environment.

---

## 38. Helm/Kustomize Values

If using Helm:

```text
values.yaml
values-prod.yaml
```

Danger:

```text
too much logic in templates
secrets in values
environment drift
unreviewed overrides
```

If using Kustomize:

```text
base
overlays/dev
overlays/prod
```

Rule:

```text
template system should reduce repetition, not hide behavior.
```

Always render manifests and review final output.

---

## 39. Secret Rotation

Secret rotation requires design.

Questions:

```text
Does app read secret at startup only?
Can app reload secret file?
Does DB pool need restart?
Can old and new credentials overlap?
How long is rotation window?
What happens to in-flight connections?
How are pods restarted?
```

For DB password:

```text
1. create new credential
2. allow both old/new if possible
3. update secret
4. restart pods rolling
5. verify
6. revoke old credential
```

Do not rotate secrets by surprise if app cannot reload.

---

## 40. Config Change Rollout

Changing config should use deployment rollout.

Example Kubernetes:

```bash
kubectl rollout restart deployment/case-api
```

or change annotation checksum:

```yaml
metadata:
  annotations:
    checksum/config: "..."
```

This triggers rolling update when ConfigMap/Secret changes.

Config changes deserve same care as code releases:

- review,
- staging,
- rollout,
- monitoring,
- rollback.

---

## 41. Config for Local Development

Local config should be easy but safe.

Options:

```text
.env file ignored by git
Docker Compose env
sample config file
dev profile
```

Commit:

```text
.env.example
application.example.properties
```

Do not commit:

```text
.env with real secrets
local DB password
API keys
```

Local defaults should not leak to production.

---

## 42. Config for CI

CI config:

```text
test DB URL
mock downstream URLs
feature flags for tests
no production secrets
short timeouts
deterministic ports
```

Use CI secrets for sensitive values.

Never print them.

CI should validate:

```text
artifact does not contain secrets
config schema passes
required keys documented
```

---

## 43. Config for Tests

Tests need config isolation.

Bad:

```text
test reads developer machine env accidentally
```

Better:

```text
test provides explicit config source
```

Example:

```java
Map<String, String> testConfig = Map.of(
    "APP_PORT", "0",
    "DB_URL", "jdbc:tc:postgresql:..."
);
```

Tests should not require real production-like secrets.

---

## 44. Config and Observability

Observe config changes:

```text
who changed
when changed
what key changed
old/new value if non-secret
deployment version
pod restart
impact metrics
```

For secrets:

```text
log presence/version/reference, not value
```

Example:

```text
DB_PASSWORD_SECRET_VERSION=2026-06-21-001
```

Then incident can correlate:

```text
error spike started after secret version change
```

---

## 45. Config and Rollback

Rollback must include config.

If code rollback but config stays incompatible:

```text
rollback fails
```

Example:

```text
new code expects FEATURE_MODE=v2
old code does not understand v2
```

Design config backward compatibility.

Use expand/contract:

```text
1. deploy code that understands old+new config
2. change config
3. remove old support later
```

---

## 46. App Server Config vs App Config Boundary

Example:

```text
Tomcat maxThreads:
  server config

DB pool max if Hikari inside app:
  app config

DB pool max if Payara datasource:
  server config

context root:
  server/deployment config

Jersey resource path:
  code

public base URL:
  app/proxy config
```

Boundary depends on deployment model.

Document ownership:

```text
app team
platform team
security team
DBA
network team
```

Unowned config becomes production risk.

---

## 47. Configuration Ownership Matrix

| Config | Owner | Runtime |
|---|---|---|
| `APP_PORT` | platform/app | Docker/K8s |
| context root | platform/app | server |
| DB URL | platform/DBA/app | app/server |
| DB pool max | app/DBA/platform | app/server |
| JWT issuer | security/app | app/gateway |
| CORS origins | security/frontend/app | proxy/app |
| timeout | app/platform | app/proxy |
| max body size | app/platform/security | proxy/server/app |
| feature flag | product/app | app/flag system |
| log level | ops/app | runtime |
| TLS cert | platform/security | proxy/server |

For every config key, know owner.

---

## 48. Bad Configuration Incident Examples

### Example 1 — PROD Uses DEV Redis

Cause:

```text
REDIS_URL not set in PROD
default localhost/dev used
```

Fix:

```text
required value
prod guardrail
startup validation
no unsafe default
```

### Example 2 — 504 After Deployment

Cause:

```text
gateway timeout 30s
app downstream timeout 60s
```

Fix:

```text
timeout budget validation
app deadline
```

### Example 3 — CORS Works in UAT, Fails in PROD

Cause:

```text
proxy handles CORS in UAT
app handles CORS in PROD
allowed origins differ
```

Fix:

```text
single CORS owner
config diff check
```

### Example 4 — Payara App Fails Only in PROD

Cause:

```text
JDBC resource manually created differently
```

Fix:

```text
asadmin provisioning as code
resource validation
```

---

## 49. Production Guardrail Examples

Validation pseudo-code:

```java
public void validateProdSafety(AppConfig config) {
    if (config.env().isProd()) {
        requireHttps(config.publicBaseUrl());

        rejectLocalhost(config.database().url());
        rejectLocalhost(config.downstreams().documentService().baseUri());

        if (config.security().authDisabled()) {
            throw new IllegalStateException("authDisabled forbidden in PROD");
        }

        if (config.cors().allowCredentials()
                && config.cors().allowedOrigins().contains("*")) {
            throw new IllegalStateException("Wildcard CORS with credentials forbidden");
        }

        if (config.http().requestTimeout().compareTo(Duration.ofSeconds(30)) > 0) {
            throw new IllegalStateException("request timeout too high for PROD");
        }
    }
}
```

Make unsafe config impossible, not merely discouraged.

---

## 50. Common Failure Modes

### 50.1 Missing Required Config

Symptom:

```text
startup failure or first request failure
```

Fix:

```text
fail fast at startup
```

### 50.2 Wrong Precedence

Symptom:

```text
env var ignored
file default wins unexpectedly
```

Fix:

```text
document precedence
log source if safe
```

### 50.3 Secret Printed in Logs

Symptom:

```text
password/token appears in startup logs
```

Fix:

```text
redaction
secret type classification
logging review
```

### 50.4 ConfigMap Changed but App Not Updated

Cause:

```text
env var config requires restart
```

Fix:

```text
rollout restart
checksum annotation
designed reload
```

### 50.5 Environment Drift

Cause:

```text
manual config change
different Helm values
server admin console mutation
```

Fix:

```text
config-as-code
diff
policy
automation
```

---

## 51. Anti-Patterns

### Anti-Pattern 1 — Config Everywhere

Random `System.getenv()` across codebase.

### Anti-Pattern 2 — Unsafe Defaults

Production accidentally connects to DEV/local.

### Anti-Pattern 3 — Secrets in Image

Secrets remain in layers.

### Anti-Pattern 4 — Profile Explosion

`dev`, `uat`, `prod`, `prod2`, `clientA`, `clientB`, each with different structure.

### Anti-Pattern 5 — No Validation

App starts with impossible config.

### Anti-Pattern 6 — No Config Ownership

Nobody knows who can change timeout/CORS/JWT.

### Anti-Pattern 7 — Live Reload Everything

Unexpected runtime behavior changes mid-request.

### Anti-Pattern 8 — Logging Effective Config With Secrets

Incident waiting to happen.

### Anti-Pattern 9 — Manual Admin Console Config

Environment cannot be rebuilt.

### Anti-Pattern 10 — Config Change Without Rollback Plan

Config can break app as much as code.

---

## 52. Decision Matrix

| Need | Preferred Approach |
|---|---|
| Simple container setting | env var |
| Non-secret structured config | mounted file / ConfigMap |
| Sensitive file/key/cert | Secret mounted file / secret manager |
| Jakarta EE portable config | MicroProfile Config |
| Server runtime feature | server.xml/domain/server config |
| DB pool in app | app config |
| DB pool in server | server resource config |
| Dynamic ops switch | feature flag system |
| Log level change | runtime logging config if supported |
| Critical secret rotation | secret manager + rolling restart/reload design |
| Production guardrail | startup validation |

---

## 53. Top-Tier Engineering Perspective

A basic engineer says:

```text
Put it in env var.
```

A senior engineer asks:

```text
What is the default and where is it overridden?
```

A top-tier engineer defines:

```text
- config schema
- source precedence
- type conversion
- validation
- secret classification
- owner
- environment guardrails
- reload/restart semantics
- observability
- audit trail
- rollback strategy
- runtime-specific config boundary
```

Configuration is not a bag of strings.

It is a runtime contract.

---

## 54. Production Readiness Checklist

```text
[ ] Config schema documented.
[ ] Every key has type/unit/default/owner.
[ ] Required keys fail fast if missing.
[ ] Unsafe defaults removed.
[ ] Config precedence documented.
[ ] Config source strategy defined per runtime.
[ ] Secrets separated from non-secret config.
[ ] Secrets never logged.
[ ] Config validation runs at startup.
[ ] PROD guardrails implemented.
[ ] Public base URL configured/validated.
[ ] CORS config validated.
[ ] Timeout config uses explicit units.
[ ] Pool config validated.
[ ] Context path/app path/proxy path documented.
[ ] Effective safe config logged at startup.
[ ] Internal effective config endpoint redacts secrets.
[ ] ConfigMap/Secret rollout strategy defined.
[ ] Secret rotation procedure documented.
[ ] Config-as-code used for server/runtime config.
[ ] Manual console drift avoided.
[ ] Config changes tested like code changes.
[ ] Rollback includes config compatibility.
```

---

## 55. Summary

Deployment-time configuration determines how Jersey behaves in each environment.

The key risks are:

```text
missing config
wrong precedence
unsafe default
secret leakage
environment drift
unvalidated timeout/pool/security values
manual server mutation
unclear reload behavior
```

Core principles:

```text
centralize config loading
type config
validate config
separate secrets
externalize environment values
avoid unsafe defaults
version server config
log safe effective config
make PROD-unsafe config impossible
```

Top-tier conclusion:

> Configuration architecture is reliability architecture.  
> A service with unvalidated config is not production-ready, no matter how clean the code is.

---

## 56. How This Part Connects to the Next Part

This part covered deployment-time configuration.

Next:

```text
Part 26 — Security Deployment Model
```

We will cover:

- TLS boundaries,
- reverse proxy trust,
- authentication location,
- authorization boundary,
- JWT/OIDC config,
- secret management,
- CORS security,
- request smuggling/header trust,
- secure cookies,
- mTLS,
- container/Kubernetes security context,
- and how Jersey deployment choices change security ownership.

---

## References

- MicroProfile Config 3.1 overview: https://microprofile.io/specifications/config/3-1/
- MicroProfile Config sources and ordinals: https://github.com/eclipse/microprofile-config/blob/master/spec/src/main/asciidoc/configsources.asciidoc
- Kubernetes ConfigMaps documentation: https://kubernetes.io/docs/concepts/configuration/configmap/
- Kubernetes documentation — Define environment variables for a container: https://kubernetes.io/docs/tasks/inject-data-application/define-environment-variable-container/
- Docker documentation — Manage sensitive data with Docker secrets: https://docs.docker.com/engine/swarm/secrets/
- Open Liberty server configuration overview: https://openliberty.io/docs/latest/reference/config/server-configuration-overview.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-024.md">⬅️ Part 24 — Connection, Timeout, and Backpressure Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-026.md">Part 26 — Security Deployment Model ➡️</a>
</div>
