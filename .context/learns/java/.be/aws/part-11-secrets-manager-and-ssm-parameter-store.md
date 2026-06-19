# Part 11 — Secrets Manager and SSM Parameter Store

Series: `learn-java-aws-sdk-lambda-cloud-integration-engineering`  
File: `part-11-secrets-manager-and-ssm-parameter-store.md`  
Scope: Java 8–25, AWS SDK for Java 2.x, AWS Secrets Manager, AWS Systems Manager Parameter Store, KMS, Spring Boot integration, operational failure modelling

---

## 0. Why This Part Matters

A production Java application almost always needs values that are not compiled into the application:

- database usernames and passwords
- API keys
- OAuth client secrets
- JWT signing material references
- webhook tokens
- third-party credentials
- feature flags
- environment-specific URLs
- queue names
- bucket names
- rate limits
- timeout values
- tenant or agency configuration

A weaker engineer sees this as a simple problem:

> "Just put it in environment variables or config files."

A stronger engineer sees the real system:

```text
application runtime
  -> config source
  -> secret source
  -> identity boundary
  -> KMS boundary
  -> cache policy
  -> rotation policy
  -> deployment policy
  -> observability policy
  -> incident recovery policy
```

The question is not only:

> "How do I get a secret?"

The deeper question is:

> "How do I let a Java service safely obtain runtime configuration and sensitive material without hardcoding it, over-fetching it, leaking it, breaking during rotation, or creating an invisible production dependency?"

This part builds that mental model.

---

## 1. The Core Distinction: Secret vs Configuration

The most important design skill is knowing what kind of value you are storing.

Not every runtime value is a secret.

Not every value belongs in Secrets Manager.

Not every environment variable is safe.

Not every encrypted value is operationally manageable.

### 1.1 Configuration

Configuration is a runtime value that changes behavior but is not inherently credential-like.

Examples:

```text
/app/aceas/dev/s3/document-bucket-name
/app/aceas/dev/sqs/case-created-queue-url
/app/aceas/dev/http/downstream-timeout-ms
/app/aceas/dev/feature/enable-new-onemap-flow
/app/aceas/dev/lambda/report-generator-memory-profile
/app/aceas/dev/api/profile-service-base-url
```

Configuration usually has these properties:

| Property | Typical behavior |
|---|---|
| Sensitive? | Usually no, sometimes mildly sensitive |
| Rotation? | Usually no |
| Versioning? | Useful but not always critical |
| Access frequency | Potentially frequent |
| Value shape | String, number, boolean, JSON, comma-list |
| Owner | App/platform team |
| Blast radius if leaked | Low to medium |
| Blast radius if wrong | Medium to high |

Common place: **AWS Systems Manager Parameter Store**.

### 1.2 Secret

A secret is a value that directly grants access, signs trust, decrypts data, or impersonates an identity.

Examples:

```text
/app/aceas/prod/db/main/credential
/app/aceas/prod/external/onemap/client-secret
/app/aceas/prod/payment/api-key
/app/aceas/prod/oauth/cpds-client-secret
/app/aceas/prod/webhook/verification-token
```

Secrets usually have these properties:

| Property | Typical behavior |
|---|---|
| Sensitive? | Yes |
| Rotation? | Often required |
| Versioning? | Critical |
| Access frequency | Should be controlled/cached |
| Value shape | JSON object, string, binary |
| Owner | App/security/platform team |
| Blast radius if leaked | High |
| Blast radius if wrong | High |

Common place: **AWS Secrets Manager**.

### 1.3 The Bad Middle Ground

Many incidents happen because teams treat secrets as ordinary config.

Bad examples:

```properties
DB_PASSWORD=prod-password
JWT_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
API_TOKEN=abc123
```

Or worse:

```java
private static final String DB_PASSWORD = "prod-password";
```

This creates several problems:

- secret leaks through Git history
- secret leaks through CI logs
- secret leaks through Docker image layers
- secret leaks through exception messages
- secret leaks through heap dumps
- secret cannot be rotated without redeploy
- secret ownership becomes unclear
- access is not auditable as a managed secret access
- production and non-production drift silently

A top-tier engineer treats configuration and secrets as separate runtime dependencies with different lifecycle rules.

---

## 2. Secrets Manager vs Parameter Store

### 2.1 Quick Decision Table

| Need | Prefer |
|---|---|
| Database credential with rotation | Secrets Manager |
| Third-party API key | Secrets Manager |
| OAuth client secret | Secrets Manager |
| JWT signing private key reference | Secrets Manager or KMS-backed design |
| Plain endpoint URL | Parameter Store String |
| Queue URL | Parameter Store String |
| Feature flag | Parameter Store String/Boolean-like convention |
| Non-secret JSON app config | Parameter Store String |
| Small encrypted config value | Parameter Store SecureString |
| Hierarchical environment config | Parameter Store |
| High-value credential requiring rotation workflow | Secrets Manager |
| Centralized secret lifecycle with staging labels | Secrets Manager |

### 2.2 AWS Secrets Manager

Secrets Manager is designed for storing, retrieving, rotating, and managing secrets. In Java applications, secrets are normally retrieved through `GetSecretValue` or `BatchGetSecretValue`; AWS recommends client-side caching to improve speed and reduce cost. AWS documents Java SDK 2.x examples for retrieving secret values and provides a Java cache abstraction called `SecretCache`.  
References:

- https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets-java.html
- https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/java_secrets-manager_code_examples.html
- https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_cache-java-ref_SecretCache.html

Secrets Manager supports version staging labels such as:

```text
AWSCURRENT
AWSPREVIOUS
AWSPENDING
```

A secret normally has an `AWSCURRENT` version, and Secrets Manager returns `AWSCURRENT` by default. Staging labels are central to rotation workflows.  
Reference:

- https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html
- https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_UpdateSecretVersionStage.html

### 2.3 AWS Systems Manager Parameter Store

Parameter Store is designed for configuration data and secure string parameters. It supports hierarchical parameter names and parameter types such as `String`, `StringList`, and `SecureString`. SecureString parameters use AWS KMS for encryption and decryption.  
References:

- https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html
- https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html

### 2.4 Practical Rule

Use this rule unless there is a strong reason not to:

```text
If the value grants access or proves identity -> Secrets Manager.
If the value configures behavior or points to infrastructure -> Parameter Store.
If the value is config-like but sensitive -> Parameter Store SecureString or Secrets Manager depending on rotation and audit needs.
```

---

## 3. The Runtime Dependency Mental Model

When your Java code calls Secrets Manager or Parameter Store, it is not reading a local map.

It is making an authenticated network call to a regional AWS API endpoint, authorized by IAM, potentially involving KMS, subject to latency, throttling, timeout, cost, and failure.

The dependency chain looks like this:

```text
Java application
  -> AWS SDK client
  -> region provider
  -> credentials provider
  -> IAM authorization
  -> Secrets Manager or SSM API
  -> KMS decrypt path if encrypted
  -> network transport
  -> SDK retry strategy
  -> response parser
  -> application parser
  -> cache
  -> business logic
```

Each arrow can fail.

### 3.1 Common Failure Points

| Layer | Failure example |
|---|---|
| Region | app points to `ap-southeast-1`, secret exists in `ap-southeast-2` |
| Credential | Lambda execution role missing permission |
| IAM | `secretsmanager:GetSecretValue` denied |
| KMS | role can read secret but cannot decrypt KMS key |
| Network | VPC endpoint missing or DNS issue |
| SDK timeout | API call hangs longer than startup budget |
| Throttling | too many secret reads during scale-out |
| Secret value | invalid JSON shape |
| Rotation | new credential not yet accepted by downstream DB |
| Cache | stale secret after rotation |
| Logging | accidental secret exposure in exception or debug log |

A mature design makes these failure modes explicit.

---

## 4. Naming and Hierarchy Design

Naming is not cosmetic. It is an authorization boundary, operational search surface, and environment separation mechanism.

### 4.1 Good Parameter Naming

Use stable, hierarchical names:

```text
/app/{app-name}/{environment}/{domain}/{name}
```

Examples:

```text
/app/aceas/dev/s3/document-bucket-name
/app/aceas/uat/sqs/case-created-queue-url
/app/aceas/prod/http/profile-service-base-url
/app/aceas/prod/feature/enable-retry-scheduler
/app/aceas/prod/onemap/rate-limit-per-minute
```

Benefits:

- IAM can scope by path
- config can be fetched by path
- environment drift is visible
- ownership is clearer
- console search is easier
- automation is simpler

### 4.2 Good Secret Naming

For secrets, use names that identify owner and purpose, not the secret value type only.

Good:

```text
/app/aceas/prod/db/main-credential
/app/aceas/prod/external/onemap-api-client
/app/aceas/prod/oauth/cpds-client
/app/aceas/prod/webhook/payment-verification
```

Weak:

```text
password
prod-password
secret1
api-key
main
```

### 4.3 Avoid Encoding Volatile Details in Names

Bad:

```text
/app/aceas/prod/db/main-password-2026-06-19
/app/aceas/prod/api-key-v7
```

Better:

```text
/app/aceas/prod/db/main-credential
/app/aceas/prod/external/onemap-api-client
```

Use versions/staging labels for versioning, not name changes.

---

## 5. Secret Shape Design

A secret is often not a single string. It is usually a structured object.

### 5.1 Database Credential Secret

```json
{
  "username": "aceas_app",
  "password": "REDACTED",
  "engine": "oracle",
  "host": "db.example.internal",
  "port": 1521,
  "database": "ACEASPROD"
}
```

### 5.2 External API Client Secret

```json
{
  "clientId": "aceas-prod-client",
  "clientSecret": "REDACTED",
  "tokenEndpoint": "https://auth.example.gov/token",
  "audience": "onemap-api"
}
```

### 5.3 Why JSON Can Be Better Than Separate Keys

A single JSON secret can preserve atomicity.

For example, this is risky:

```text
/app/aceas/prod/db/username
/app/aceas/prod/db/password
/app/aceas/prod/db/host
/app/aceas/prod/db/port
```

During update, one value may change before another. Your app may read a mixed configuration set.

A single versioned JSON secret avoids that:

```text
/app/aceas/prod/db/main-credential
```

With value:

```json
{
  "username": "aceas_app_v2",
  "password": "REDACTED",
  "host": "db-prod.cluster.internal",
  "port": 1521
}
```

### 5.4 But Do Not Abuse JSON Secret as a Config Dump

Bad:

```json
{
  "dbPassword": "...",
  "bucketName": "...",
  "queueUrl": "...",
  "featureFlag1": true,
  "retryCount": 3,
  "reportTitle": "...",
  "emailTemplate": "..."
}
```

This destroys separation of responsibility.

Better:

```text
Secrets Manager:
  /app/aceas/prod/db/main-credential
  /app/aceas/prod/external/onemap-api-client

Parameter Store:
  /app/aceas/prod/s3/document-bucket-name
  /app/aceas/prod/sqs/case-created-queue-url
  /app/aceas/prod/http/downstream-timeout-ms
```

---

## 6. IAM Design for Secrets and Parameters

### 6.1 Read Only What You Need

Bad policy:

```json
{
  "Effect": "Allow",
  "Action": "secretsmanager:*",
  "Resource": "*"
}
```

Better policy:

```json
{
  "Effect": "Allow",
  "Action": [
    "secretsmanager:GetSecretValue",
    "secretsmanager:DescribeSecret"
  ],
  "Resource": [
    "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:/app/aceas/prod/db/main-credential-*",
    "arn:aws:secretsmanager:ap-southeast-1:123456789012:secret:/app/aceas/prod/external/onemap-api-client-*"
  ]
}
```

For Parameter Store:

```json
{
  "Effect": "Allow",
  "Action": [
    "ssm:GetParameter",
    "ssm:GetParameters",
    "ssm:GetParametersByPath"
  ],
  "Resource": "arn:aws:ssm:ap-southeast-1:123456789012:parameter/app/aceas/prod/*"
}
```

### 6.2 Remember KMS Permission

If the secret or SecureString uses a customer-managed KMS key, the role may also need decrypt permission.

Example:

```json
{
  "Effect": "Allow",
  "Action": "kms:Decrypt",
  "Resource": "arn:aws:kms:ap-southeast-1:123456789012:key/11111111-2222-3333-4444-555555555555",
  "Condition": {
    "StringEquals": {
      "kms:ViaService": "secretsmanager.ap-southeast-1.amazonaws.com"
    }
  }
}
```

The condition narrows use so the key can be used through Secrets Manager in the expected region.

### 6.3 Separate Runtime Read Role from Admin Write Role

A runtime Java service normally needs read access only.

```text
runtime role:
  GetSecretValue
  DescribeSecret
  GetParameter
  GetParameters
  GetParametersByPath
  kms:Decrypt

admin/deployment role:
  CreateSecret
  PutSecretValue
  UpdateSecret
  UpdateSecretVersionStage
  PutParameter
  DeleteParameter
  TagResource
```

Do not let the application role mutate its own secret unless there is a strong, reviewed reason.

---

## 7. AWS SDK Client Lifecycle

### 7.1 Reuse Clients

Do not create a new `SecretsManagerClient` or `SsmClient` for every request.

Bad:

```java
public String loadSecret(String secretId) {
    try (SecretsManagerClient client = SecretsManagerClient.create()) {
        return client.getSecretValue(r -> r.secretId(secretId)).secretString();
    }
}
```

This repeatedly builds clients, credentials providers, HTTP resources, and connection pools.

Better:

```java
public final class AwsSecretReader implements AutoCloseable {
    private final SecretsManagerClient client;

    public AwsSecretReader(SecretsManagerClient client) {
        this.client = Objects.requireNonNull(client, "client");
    }

    public String getSecretString(String secretId) {
        return client.getSecretValue(r -> r.secretId(secretId)).secretString();
    }

    @Override
    public void close() {
        client.close();
    }
}
```

Client creation belongs in application bootstrap or DI container wiring.

### 7.2 Example SDK v2 Client Construction

```java
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.ssm.SsmClient;

public final class AwsClients {
    private final SecretsManagerClient secretsManager;
    private final SsmClient ssm;

    public AwsClients(Region region) {
        this.secretsManager = SecretsManagerClient.builder()
                .region(region)
                .build();

        this.ssm = SsmClient.builder()
                .region(region)
                .build();
    }

    public SecretsManagerClient secretsManager() {
        return secretsManager;
    }

    public SsmClient ssm() {
        return ssm;
    }

    public void close() {
        secretsManager.close();
        ssm.close();
    }
}
```

### 7.3 Production Client Should Have Explicit Timeouts

Do not rely blindly on defaults.

```java
import software.amazon.awssdk.core.client.config.ClientOverrideConfiguration;
import software.amazon.awssdk.http.apache.ApacheHttpClient;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;

import java.time.Duration;

SecretsManagerClient client = SecretsManagerClient.builder()
        .region(region)
        .httpClientBuilder(ApacheHttpClient.builder()
                .connectionTimeout(Duration.ofSeconds(2))
                .socketTimeout(Duration.ofSeconds(3))
                .connectionAcquisitionTimeout(Duration.ofSeconds(1))
                .maxConnections(50))
        .overrideConfiguration(ClientOverrideConfiguration.builder()
                .apiCallAttemptTimeout(Duration.ofSeconds(4))
                .apiCallTimeout(Duration.ofSeconds(8))
                .build())
        .build();
```

Timeout values must be tuned to the application startup and request latency budget.

---

## 8. Reading Secrets in Java

### 8.1 Minimal Secret Reader

```java
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueResponse;

import java.util.Objects;

public final class SecretValueReader {
    private final SecretsManagerClient client;

    public SecretValueReader(SecretsManagerClient client) {
        this.client = Objects.requireNonNull(client, "client");
    }

    public String getSecretString(String secretId) {
        GetSecretValueResponse response = client.getSecretValue(GetSecretValueRequest.builder()
                .secretId(secretId)
                .build());

        String value = response.secretString();
        if (value == null) {
            throw new IllegalStateException("Secret does not contain a string value: " + secretId);
        }
        return value;
    }
}
```

### 8.2 Do Not Log Secret Values

Bad:

```java
log.info("Loaded secret {} value={}", secretId, secretValue);
```

Better:

```java
log.info("Loaded secret metadata: secretId={}, versionId={}, createdDate={}",
        safeSecretName(secretId),
        response.versionId(),
        response.createdDate());
```

Even better: avoid logging version ID if it is not operationally needed.

### 8.3 Parse Secret into a Typed Object

Do not pass raw JSON everywhere.

```java
public record DbCredential(
        String username,
        String password,
        String host,
        int port,
        String database
) {
    public DbCredential {
        if (isBlank(username)) throw new IllegalArgumentException("username is required");
        if (isBlank(password)) throw new IllegalArgumentException("password is required");
        if (isBlank(host)) throw new IllegalArgumentException("host is required");
        if (port <= 0 || port > 65535) throw new IllegalArgumentException("invalid port");
        if (isBlank(database)) throw new IllegalArgumentException("database is required");
    }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
```

For Java 8, use a final class instead of `record`.

```java
public final class DbCredentialJava8 {
    private final String username;
    private final String password;
    private final String host;
    private final int port;
    private final String database;

    public DbCredentialJava8(String username, String password, String host, int port, String database) {
        if (isBlank(username)) throw new IllegalArgumentException("username is required");
        if (isBlank(password)) throw new IllegalArgumentException("password is required");
        if (isBlank(host)) throw new IllegalArgumentException("host is required");
        if (port <= 0 || port > 65535) throw new IllegalArgumentException("invalid port");
        if (isBlank(database)) throw new IllegalArgumentException("database is required");
        this.username = username;
        this.password = password;
        this.host = host;
        this.port = port;
        this.database = database;
    }

    public String username() { return username; }
    public String password() { return password; }
    public String host() { return host; }
    public int port() { return port; }
    public String database() { return database; }

    private static boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
```

### 8.4 Secret Parsing Failure Is a Deployment Failure

If a required secret is malformed, the application should usually fail startup.

Bad behavior:

```text
secret malformed -> app starts -> first user request fails -> incident hidden until traffic
```

Better behavior:

```text
secret malformed -> startup validation fails -> deployment fails fast -> rollback/repair
```

---

## 9. Reading Parameters in Java

### 9.1 Single Parameter

```java
import software.amazon.awssdk.services.ssm.SsmClient;
import software.amazon.awssdk.services.ssm.model.GetParameterRequest;
import software.amazon.awssdk.services.ssm.model.GetParameterResponse;

public final class ParameterReader {
    private final SsmClient client;

    public ParameterReader(SsmClient client) {
        this.client = client;
    }

    public String getString(String name) {
        GetParameterResponse response = client.getParameter(GetParameterRequest.builder()
                .name(name)
                .withDecryption(false)
                .build());
        return response.parameter().value();
    }

    public String getSecureString(String name) {
        GetParameterResponse response = client.getParameter(GetParameterRequest.builder()
                .name(name)
                .withDecryption(true)
                .build());
        return response.parameter().value();
    }
}
```

### 9.2 Fetching by Path

Fetching by path is useful during startup.

```java
import software.amazon.awssdk.services.ssm.model.GetParametersByPathRequest;
import software.amazon.awssdk.services.ssm.model.GetParametersByPathResponse;
import software.amazon.awssdk.services.ssm.model.Parameter;

import java.util.LinkedHashMap;
import java.util.Map;

public Map<String, String> getByPath(String path) {
    Map<String, String> values = new LinkedHashMap<>();
    String nextToken = null;

    do {
        GetParametersByPathResponse response = client.getParametersByPath(GetParametersByPathRequest.builder()
                .path(path)
                .recursive(true)
                .withDecryption(true)
                .nextToken(nextToken)
                .build());

        for (Parameter parameter : response.parameters()) {
            values.put(parameter.name(), parameter.value());
        }

        nextToken = response.nextToken();
    } while (nextToken != null && !nextToken.isEmpty());

    return values;
}
```

### 9.3 Avoid Fetching the Whole World

Bad:

```text
/app/aceas/prod/*
```

Fetched by every service.

Better:

```text
/app/aceas/prod/case-service/*
/app/aceas/prod/document-service/*
/app/aceas/prod/shared/http/*
```

Each service should fetch only the config it owns or needs.

---

## 10. Startup Loading vs Lazy Loading vs Refresh

There are three common strategies.

### 10.1 Startup Loading

The app loads required secrets/config at startup.

```text
start app
  -> resolve region
  -> resolve credentials
  -> fetch required parameters
  -> fetch required secrets
  -> parse and validate
  -> construct clients/pools
  -> mark app ready
```

Good for:

- database credentials
- required endpoints
- required queue URLs
- mandatory bucket names
- service identity config

Pros:

- fail fast
- easier readiness semantics
- fewer runtime surprises
- easier deployment validation

Cons:

- slower startup
- scale-out can create read burst
- secret store outage can block deployment

### 10.2 Lazy Loading

The app loads a value when first needed.

Good for:

- rarely used external integration
- optional feature
- admin-only workflow
- expensive secret rarely accessed

Pros:

- faster startup
- less initial dependency

Cons:

- first user request pays latency
- failure appears at runtime
- harder to detect deployment issue

### 10.3 Periodic Refresh

The app refreshes values in the background.

Good for:

- rotated credentials
- feature flags
- downstream timeout tuning
- rate limit tuning

Pros:

- supports rotation
- reduces redeploy need
- allows operational control

Cons:

- needs thread lifecycle management
- stale vs fresh semantics must be clear
- partial refresh failure must be handled

### 10.4 Decision Table

| Value | Recommended strategy |
|---|---|
| DB credential | startup load + cache + rotation-aware refresh/pool strategy |
| External API secret | startup or lazy + cache |
| Required endpoint | startup load |
| Feature flag | startup + periodic refresh |
| Queue URL | startup load |
| S3 bucket name | startup load |
| Optional integration token | lazy + cache |

---

## 11. Caching Secrets

AWS recommends caching secrets client-side to improve speed and reduce cost. This is especially important for Java services under load and for Lambda functions invoked frequently.

### 11.1 Why Cache

Without cache:

```text
request 1 -> GetSecretValue
request 2 -> GetSecretValue
request 3 -> GetSecretValue
...
```

Problems:

- higher latency
- higher cost
- higher throttling risk
- more dependency on AWS API availability
- more KMS decrypt operations depending on path

With cache:

```text
request 1 -> cache miss -> GetSecretValue -> cache
request 2 -> cache hit
request 3 -> cache hit
...
periodic refresh -> GetSecretValue
```

### 11.2 Cache Scope

| Runtime | Cache scope |
|---|---|
| Spring Boot service | process-level singleton cache |
| Lambda | static field cache reused across warm invocations |
| Batch job | process-level cache for job duration |
| CLI tool | usually no long-lived cache needed |

### 11.3 Cache TTL Must Match Rotation Strategy

If secret rotates every 30 days, a 5-minute cache may be fine.

If secret can rotate during incident recovery, a 24-hour cache may be too stale.

A good policy:

```text
normal refresh TTL: 5–15 minutes
emergency refresh path: explicit cache invalidation or process restart
failure behavior: continue with previous valid value for bounded time if safe
```

### 11.4 Cache Failure Policy

There are two different cases.

Case 1: no cached value exists.

```text
cache miss -> AWS unavailable -> fail startup or fail request
```

Case 2: cached value exists.

```text
cache refresh -> AWS unavailable -> keep old value -> emit metric/log -> retry later
```

This distinction matters.

Do not erase a working cached secret because refresh failed.

### 11.5 Simple Cache Pattern

```java
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicReference;

public final class RefreshingValue<T> {
    private final Duration ttl;
    private final Clock clock;
    private final Loader<T> loader;
    private final AtomicReference<Entry<T>> entry = new AtomicReference<>();

    public RefreshingValue(Duration ttl, Clock clock, Loader<T> loader) {
        this.ttl = Objects.requireNonNull(ttl, "ttl");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.loader = Objects.requireNonNull(loader, "loader");
    }

    public T get() {
        Entry<T> current = entry.get();
        Instant now = clock.instant();

        if (current != null && now.isBefore(current.expiresAt)) {
            return current.value;
        }

        synchronized (this) {
            current = entry.get();
            now = clock.instant();
            if (current != null && now.isBefore(current.expiresAt)) {
                return current.value;
            }

            T loaded = loader.load();
            entry.set(new Entry<>(loaded, now.plus(ttl)));
            return loaded;
        }
    }

    public interface Loader<T> {
        T load();
    }

    private static final class Entry<T> {
        private final T value;
        private final Instant expiresAt;

        private Entry(T value, Instant expiresAt) {
            this.value = value;
            this.expiresAt = expiresAt;
        }
    }
}
```

This is intentionally simple. Production cache often needs:

- async refresh
- metrics
- jitter
- stale-if-error
- max stale duration
- invalidation
- per-key concurrency control
- no secret in `toString()`

---

## 12. Rotation Mental Model

Secret rotation is not simply updating a value.

It is a distributed state transition involving:

```text
old secret value
new secret value
secret store
application cache
downstream system
connection pool
IAM/KMS permissions
rollout timing
rollback path
```

### 12.1 Secrets Manager Staging Labels

Common staging labels:

```text
AWSCURRENT   -> current production version
AWSPREVIOUS  -> previous version
AWSPENDING   -> version being prepared/tested during rotation
```

The application normally reads `AWSCURRENT`.

### 12.2 Rotation Race Example: Database Credential

A dangerous sequence:

```text
1. Secrets Manager AWSCURRENT changes to new DB password.
2. App refreshes cache and gets new password.
3. DB user password has not actually been updated or propagated.
4. App opens new DB connections and authentication fails.
5. Old pooled connections still work for a while.
6. New traffic gradually fails.
```

A safe rotation must coordinate:

- create new credential
- test new credential
- promote staging label
- update downstream system
- refresh app cache/pool
- retain previous credential long enough for rollback

### 12.3 Application Responsibility During Rotation

The Java app should:

- not read secret per request
- handle authentication failure as a possible stale/rotated credential signal
- allow bounded refresh/retry
- rebuild affected clients/pools safely
- avoid logging the new credential
- emit metrics on refresh success/failure

### 12.4 HikariCP and DB Credential Rotation

A common trap:

```text
Secret rotated -> app cache updated -> HikariCP existing pool still uses old password config
```

Connection pools do not magically reconfigure because a secret changed.

Possible strategies:

1. **Restart service after rotation**
   - simplest
   - operationally clear
   - works well with rolling deployment

2. **Rebuild DataSource/pool on secret change**
   - more complex
   - requires safe switchover
   - must avoid request disruption

3. **Use database auth mechanism with temporary tokens**
   - service-specific
   - shifts complexity to token lifecycle

For most enterprise Java systems, a controlled rolling restart after DB secret rotation is often safer than hot-swapping pools unless you have strong infrastructure for it.

---

## 13. SecureString Parameter Store Design

`SecureString` is useful for encrypted parameters, but it is not the same operational model as Secrets Manager.

### 13.1 Good SecureString Use Cases

- low-complexity encrypted value
- non-rotated or manually rotated token
- internal config that should not be plaintext
- environment-specific sensitive value with simple lifecycle

### 13.2 Weak SecureString Use Cases

- frequently rotated DB credentials
- secret requiring staging labels
- secret requiring managed rotation workflow
- complex credential lifecycle

### 13.3 SecureString Still Needs IAM + KMS

A SecureString can fail because:

- role lacks `ssm:GetParameter`
- role lacks `kms:Decrypt`
- parameter exists in different region
- wrong KMS key policy
- `withDecryption(true)` not set

### 13.4 Application-Level Handling

Do not treat SecureString as less sensitive because it came from Parameter Store.

Bad:

```java
log.info("Parameter {} = {}", name, value);
```

Better:

```java
log.info("Loaded secure parameter: name={}", name);
```

---

## 14. Spring Boot Integration

### 14.1 Keep AWS Access Behind Application Abstraction

Do not inject `SecretsManagerClient` everywhere.

Bad:

```java
@Service
public class PaymentService {
    private final SecretsManagerClient secrets;

    public PaymentService(SecretsManagerClient secrets) {
        this.secrets = secrets;
    }

    public void pay() {
        String apiKey = secrets.getSecretValue(r -> r.secretId("...")).secretString();
        // business logic
    }
}
```

Better:

```java
public interface PaymentCredentialProvider {
    PaymentCredential currentCredential();
}
```

```java
@Service
public class PaymentService {
    private final PaymentCredentialProvider credentials;

    public PaymentService(PaymentCredentialProvider credentials) {
        this.credentials = credentials;
    }

    public void pay() {
        PaymentCredential credential = credentials.currentCredential();
        // business logic
    }
}
```

This keeps AWS concerns at infrastructure boundary.

### 14.2 Spring Bean Setup

```java
@Configuration
public class AwsSecretConfig {

    @Bean(destroyMethod = "close")
    SecretsManagerClient secretsManagerClient(AppAwsProperties props) {
        return SecretsManagerClient.builder()
                .region(Region.of(props.region()))
                .build();
    }

    @Bean(destroyMethod = "close")
    SsmClient ssmClient(AppAwsProperties props) {
        return SsmClient.builder()
                .region(Region.of(props.region()))
                .build();
    }
}
```

### 14.3 Bind Secret IDs, Not Secret Values

Application config should contain identifiers, not secret values.

```yaml
app:
  aws:
    region: ap-southeast-1
  secrets:
    databaseCredentialSecretId: /app/aceas/prod/db/main-credential
    onemapClientSecretId: /app/aceas/prod/external/onemap-api-client
  parameters:
    documentBucketName: /app/aceas/prod/s3/document-bucket-name
```

Bad:

```yaml
app:
  db:
    password: prod-password
```

### 14.4 Startup Validation Component

```java
@Component
public final class RuntimeDependencyValidator implements SmartLifecycle {
    private final DbCredentialProvider dbCredentialProvider;
    private final AppConfigProvider appConfigProvider;
    private volatile boolean running;

    public RuntimeDependencyValidator(DbCredentialProvider dbCredentialProvider,
                                      AppConfigProvider appConfigProvider) {
        this.dbCredentialProvider = dbCredentialProvider;
        this.appConfigProvider = appConfigProvider;
    }

    @Override
    public void start() {
        dbCredentialProvider.current();
        appConfigProvider.requiredConfig();
        running = true;
    }

    @Override
    public void stop() {
        running = false;
    }

    @Override
    public boolean isRunning() {
        return running;
    }
}
```

This makes missing/malformed secrets visible during startup.

---

## 15. Lambda Integration

Lambda has different lifecycle constraints.

### 15.1 Static Client and Cache

```java
public final class Handler implements RequestHandler<MyEvent, MyResponse> {
    private static final Region REGION = Region.of(System.getenv("AWS_REGION"));

    private static final SecretsManagerClient SECRETS = SecretsManagerClient.builder()
            .region(REGION)
            .build();

    private static final RefreshingValue<String> API_SECRET = new RefreshingValue<>(
            Duration.ofMinutes(10),
            Clock.systemUTC(),
            () -> SECRETS.getSecretValue(r -> r.secretId(System.getenv("API_SECRET_ID"))).secretString()
    );

    @Override
    public MyResponse handleRequest(MyEvent event, Context context) {
        String secret = API_SECRET.get();
        // use secret
        return new MyResponse("ok");
    }
}
```

Static initialization allows reuse across warm invocations.

### 15.2 Lambda Cold Start Consideration

If you load all secrets during static init, cold start latency increases and cold start can fail when secret store access fails.

If you lazy load inside handler, first invocation pays the cost.

Choose intentionally.

### 15.3 Lambda Environment Variables Should Store References

Good:

```text
DB_SECRET_ID=/app/aceas/prod/db/main-credential
ONEMAP_SECRET_ID=/app/aceas/prod/external/onemap-api-client
CONFIG_PATH=/app/aceas/prod/report-lambda/
```

Bad:

```text
DB_PASSWORD=prod-password
ONEMAP_CLIENT_SECRET=secret
```

---

## 16. Kubernetes/EKS Integration

A Java service in EKS typically has several options.

### 16.1 Runtime SDK Fetch

The app calls Secrets Manager/SSM directly using IRSA or Pod Identity.

```text
pod -> service account -> IAM role -> AWS SDK -> Secrets Manager/SSM
```

Pros:

- app controls cache/refresh
- direct audit trail
- no secret copied into Kubernetes Secret unless you choose to

Cons:

- app depends on AWS API at runtime
- each app must implement access/caching correctly

### 16.2 Sync to Kubernetes Secret

A controller or script syncs AWS secrets into Kubernetes Secret.

```text
Secrets Manager/SSM -> sync process -> Kubernetes Secret -> pod env/file
```

Pros:

- app simpler
- startup fast
- works with standard Spring config

Cons:

- secret now exists in Kubernetes Secret store
- rotation propagation is another system
- audit trail shifts
- stale value risk

### 16.3 Best Choice Depends on Operational Model

For highly sensitive, rotation-aware secrets, direct runtime fetch may be better.

For stable infrastructure config, Kubernetes-provided env/config may be simpler.

For regulated systems, explicitly document where the secret exists:

```text
Secrets Manager
KMS
CloudTrail
Kubernetes Secret
Pod env var
Process memory
Heap dump
Logs
Backup
```

---

## 17. Observability and Audit

### 17.1 What to Log

Log metadata, never secret value.

Useful logs:

```text
secret_load_success secretIdHash=... durationMs=... source=secrets-manager
secret_load_failure secretIdHash=... errorType=AccessDeniedException retryable=false
parameter_load_success path=/app/aceas/prod/case-service count=17 durationMs=...
secret_cache_refresh_failure secretIdHash=... usingStale=true staleAgeSeconds=123
```

### 17.2 What to Measure

Metrics:

```text
secret.load.count
secret.load.failure.count
secret.load.duration
secret.cache.hit.count
secret.cache.miss.count
secret.cache.refresh.failure.count
secret.cache.stale.age
parameter.load.count
parameter.load.failure.count
parameter.load.duration
kms.decrypt.failure.count
```

### 17.3 Correlation

When debugging startup incident:

```text
application deployment ID
pod/task/function name
AWS role ARN
AWS region
secret ID hash or sanitized name
request ID from AWS response/exception
CloudTrail event
KMS decrypt event
```

### 17.4 Never Put Secrets in Metrics Labels

Bad:

```text
secret_value="abc123"
username="aceas_app"
password="..."
```

Metrics systems are often widely accessible and long-retained.

---

## 18. Failure Modelling

### 18.1 AccessDeniedException

Meaning:

```text
identity exists but lacks permission
```

Likely causes:

- wrong IAM role
- missing secret permission
- missing KMS permission
- resource ARN mismatch
- condition mismatch
- secret name changed

App behavior:

- fail startup for required secret
- do not retry aggressively
- emit clear sanitized diagnostic

### 18.2 ResourceNotFoundException

Likely causes:

- wrong region
- wrong environment path
- typo in secret ID
- secret deleted
- cross-account ARN not used

App behavior:

- fail startup for required values
- include region and sanitized ID in diagnostic

### 18.3 ThrottlingException

Likely causes:

- scale-out storm
- no cache
- fetching secret per request
- too many parameters by path
- shared account quota pressure

App behavior:

- use SDK retry with jitter
- cache values
- stagger startup
- avoid per-request secret fetch

### 18.4 KMS Access Failure

Likely causes:

- key policy missing principal
- IAM policy missing `kms:Decrypt`
- wrong key region
- condition mismatch

App behavior:

- fail startup
- surface KMS failure separately from missing secret

### 18.5 Malformed Secret

Likely causes:

- manual edit
- incomplete deployment
- wrong JSON schema
- missing field

App behavior:

- fail fast
- do not use partial default for credential
- validate schema

### 18.6 Stale Secret

Likely causes:

- long TTL
- failed refresh
- rotation not coordinated
- old Lambda execution environment

App behavior:

- refresh on auth failure if safe
- bound max stale duration
- expose stale age metric
- allow restart/rollout as operational fix

---

## 19. Deployment and Environment Strategy

### 19.1 Environment Separation

Use explicit environment path:

```text
/app/aceas/dev/...
/app/aceas/uat/...
/app/aceas/prod/...
```

Do not infer production secrets from branch name alone.

### 19.2 Promotion Model

Do not copy production secret value backward into lower environments.

A safer pattern:

```text
DEV: synthetic credential
UAT: UAT-only credential
PROD: PROD-only credential
```

### 19.3 Deployment Validation

Before deploying app:

```text
1. Validate secret exists.
2. Validate parameter path exists.
3. Validate runtime role can read required values.
4. Validate KMS decrypt works.
5. Validate JSON schema.
6. Validate downstream credential works if safe.
```

This can be done by a preflight job using the same IAM role or a close equivalent.

### 19.4 Immutable Artifact, Mutable Runtime Reference

The same application artifact should be deployable across environments.

Artifact contains:

```text
code
libraries
static defaults
schema
```

Environment provides:

```text
region
secret IDs
parameter paths
role
network
```

This reduces environment-specific builds.

---

## 20. Anti-Patterns

### 20.1 Fetch Secret Per Request

```java
public Response handle(Request request) {
    String secret = secrets.getSecretValue(r -> r.secretId(secretId)).secretString();
    return callDownstream(secret, request);
}
```

Why bad:

- latency overhead
- cost overhead
- throttling risk
- downstream failure amplification

### 20.2 Catch and Ignore Secret Load Failure

```java
try {
    secret = loadSecret();
} catch (Exception e) {
    secret = "default";
}
```

This is catastrophic if default points to wrong environment or unsafe credential.

### 20.3 Store Secret in Static Constant

```java
private static final String TOKEN = "abc123";
```

This is a source control and artifact leak.

### 20.4 Print Full Config Object

```java
log.info("App config: {}", config);
```

If config object includes secrets, this leaks them.

### 20.5 Overload Parameter Store as Database

Parameter Store is not a low-latency dynamic config database for hot path reads.

Bad:

```text
For every user request:
  GetParameter(/feature/some-flag)
```

Better:

```text
Load/cache/refresh periodically.
```

### 20.6 One Giant Secret for Everything

```text
/app/aceas/prod/all-secrets
```

Problems:

- least privilege impossible
- rotation coupling
- ownership unclear
- blast radius huge

---

## 21. A Production-Grade Secret Provider Design

### 21.1 Interface

```java
public interface SecretProvider<T> {
    T current();
}
```

### 21.2 Typed Provider

```java
public final class DbCredentialProvider implements SecretProvider<DbCredential> {
    private final RefreshingValue<DbCredential> cache;

    public DbCredentialProvider(SecretValueReader reader,
                                String secretId,
                                ObjectMapper objectMapper,
                                Duration ttl) {
        this.cache = new RefreshingValue<>(ttl, Clock.systemUTC(), () -> {
            String json = reader.getSecretString(secretId);
            try {
                return objectMapper.readValue(json, DbCredential.class);
            } catch (IOException e) {
                throw new IllegalStateException("Invalid DB credential secret shape: " + secretId, e);
            }
        });
    }

    @Override
    public DbCredential current() {
        return cache.get();
    }
}
```

### 21.3 Better Production Provider Adds

```text
metrics
sanitized logs
refresh lock
jittered TTL
stale-if-error
max stale time
explicit invalidate()
startup validation
schema version validation
```

### 21.4 Schema Version in Secret

For long-lived systems, include schema version.

```json
{
  "schemaVersion": 1,
  "username": "aceas_app",
  "password": "REDACTED",
  "host": "db.internal",
  "port": 1521,
  "database": "ACEASPROD"
}
```

Then validate:

```text
if schemaVersion unsupported -> fail fast
```

---

## 22. Configuration Provider Design

### 22.1 Typed App Config

```java
public record CaseServiceConfig(
        String documentBucketName,
        String caseCreatedQueueUrl,
        Duration downstreamTimeout,
        int maxRetryAttempts,
        boolean newScreeningFlowEnabled
) {}
```

Java 8 version can use a final class.

### 22.2 Avoid Stringly-Typed Config Everywhere

Bad:

```java
String timeout = config.get("/app/aceas/prod/http/downstream-timeout-ms");
int timeoutMs = Integer.parseInt(timeout);
```

Repeated across codebase.

Better:

```java
CaseServiceConfig config = configProvider.current();
Duration timeout = config.downstreamTimeout();
```

### 22.3 Validate Domain Constraints

```text
maxRetryAttempts >= 0 and <= 5
downstreamTimeout between 100 ms and 30 seconds
bucket name not blank
queue URL starts with https://sqs.
```

Do not accept invalid config just because it is syntactically parseable.

---

## 23. Interaction With Java Versions 8–25

### 23.1 Java 8

Use:

- final classes instead of records
- `Optional` carefully
- no `var`
- no modern switch expression
- AWS SDK 2.x still supports Java 8 baseline

### 23.2 Java 11/17

Better TLS/runtime baseline, better container behavior, stronger library ecosystem.

Use:

- `HttpClient` if relevant outside AWS SDK
- better GC defaults
- records only from Java 16+, so Java 17 can use them

### 23.3 Java 21/25

Useful for modern services:

- records
- pattern matching where applicable
- virtual threads for non-AWS work if architecture supports it
- better runtime ergonomics

But AWS secret/config access should still be designed around:

- bounded I/O
- caching
- explicit timeouts
- no per-request remote config access

Virtual threads do not remove the need for caching and throttling control.

---

## 24. Security Hygiene in Java Code

### 24.1 Avoid Secret in `toString()`

Bad:

```java
public record DbCredential(String username, String password) {}
```

The generated `toString()` includes password.

Better:

```java
public final class DbCredential {
    private final String username;
    private final String password;

    public DbCredential(String username, String password) {
        this.username = username;
        this.password = password;
    }

    public String username() { return username; }
    public String password() { return password; }

    @Override
    public String toString() {
        return "DbCredential{username='" + username + "', password='***'}";
    }
}
```

If using records, override `toString()`.

```java
public record DbCredential(String username, String password) {
    @Override
    public String toString() {
        return "DbCredential[username=" + username + ", password=***]";
    }
}
```

### 24.2 Avoid Secret in Exception Message

Bad:

```java
throw new IllegalStateException("Failed to login with password " + password);
```

Better:

```java
throw new IllegalStateException("Failed to authenticate with configured database credential");
```

### 24.3 Be Careful With Heap Dumps

Secrets loaded as `String` remain in heap until garbage collected and can appear in heap dumps.

Java cannot reliably erase immutable `String` contents.

For extremely sensitive material, consider designs that avoid long-lived plaintext in application memory, but for most application credentials, the operational focus is:

- restrict heap dump access
- encrypt dump storage
- scrub before sharing
- avoid unnecessary retention
- do not copy secrets into many objects

### 24.4 Do Not Put Secrets in MDC

Bad:

```java
MDC.put("apiKey", apiKey);
```

MDC values are copied into logs.

---

## 25. Multi-Account and Cross-Account Access

### 25.1 Same Account Runtime

Simplest:

```text
Java service in account A
  -> role in account A
  -> secret in account A
```

### 25.2 Cross-Account Secret Access

Possible pattern:

```text
Java service in workload account
  -> AssumeRole into shared-secrets account
  -> GetSecretValue by full ARN
```

Or resource policy-based access depending on governance.

When accessing a secret from another account, use full ARN instead of relying on name resolution.

### 25.3 Risks

- more complex IAM
- more complex KMS key policy
- harder incident debugging
- increased blast radius if shared account is mismanaged

Use cross-account secret access only when it supports a clear governance model.

---

## 26. Cost and Quota Considerations

Secrets/config access has operational cost.

### 26.1 Cost Drivers

```text
GetSecretValue calls
BatchGetSecretValue calls
KMS decrypt calls
Parameter Store API calls
CloudWatch logs from excessive debug
Lambda cold-start bursts
scale-out storms
```

### 26.2 Cost-Aware Design

- fetch once at startup when possible
- cache secrets
- batch parameter retrieval
- avoid per-request config reads
- use jitter on refresh
- share provider within process
- use path scoping carefully
- monitor call count

### 26.3 Scale-Out Storm Example

```text
200 pods start at once
each pod loads 20 parameters + 5 secrets
= 4,000 parameter calls + 1,000 secret calls in a short window
```

Mitigations:

- startup jitter
- batch retrieval
- fewer config keys
- pre-warmed deployment
- staged rollout
- sidecar/cache layer only if justified

---

## 27. Operational Playbooks

### 27.1 Missing Secret During Deployment

Symptoms:

```text
ResourceNotFoundException
startup failed
readiness probe never passes
```

Check:

```text
region
account
secret name/path
environment variable reference
deployment config
secret deletion history
```

Action:

```text
create/restore secret
fix reference
redeploy
```

### 27.2 Access Denied

Symptoms:

```text
AccessDeniedException from Secrets Manager/SSM/KMS
```

Check:

```text
runtime role ARN
IAM policy
resource ARN
KMS key policy
permission boundary
SCP
condition keys
region
```

Action:

```text
fix least-privilege policy
validate with same role
restart/redeploy if needed
```

### 27.3 Secret Rotated, App Failing Authentication

Symptoms:

```text
DB login failure
external API 401
sudden increase in auth errors
```

Check:

```text
secret version labels
rotation event time
app cache TTL
connection pool age
downstream credential status
AWSPREVIOUS still valid?
```

Action:

```text
refresh/restart app
roll back staging label if needed
restore previous credential if safe
fix rotation workflow
```

### 27.4 Throttling During Deployment

Symptoms:

```text
ThrottlingException
startup slow
random pod failures
```

Check:

```text
number of pods/tasks/functions started
number of secrets/parameters loaded
cache behavior
retry settings
batching
```

Action:

```text
stagger rollout
add caching
batch parameter fetch
reduce startup reads
request quota increase if justified
```

---

## 28. Reference Architecture

```text
                         +---------------------+
                         | Deployment config   |
                         | secret IDs, paths   |
                         +----------+----------+
                                    |
                                    v
+------------------+      +--------------------+      +----------------------+
| Java service     |----->| Config provider    |----->| SSM Parameter Store  |
| Spring/Lambda    |      | typed + cached     |      | String/SecureString  |
+--------+---------+      +--------------------+      +----------+-----------+
         |                                                       |
         |                                                       v
         |                                            +----------------------+
         |                                            | KMS if SecureString  |
         |                                            +----------------------+
         |
         v
+------------------+      +--------------------+      +----------------------+
| Business logic   |----->| Secret provider    |----->| Secrets Manager      |
| no AWS leakage   |      | typed + cached     |      | versioned secret     |
+------------------+      +--------------------+      +----------+-----------+
                                                               |
                                                               v
                                                    +----------------------+
                                                    | KMS decrypt path     |
                                                    +----------------------+
```

Business logic should depend on typed providers, not raw AWS SDK clients.

---

## 29. Checklist: Production-Ready Secret and Config Access

### 29.1 Design Checklist

- [ ] Secret and config values are classified separately.
- [ ] Secrets Manager is used for credential-like values.
- [ ] Parameter Store is used for non-secret runtime config.
- [ ] Naming hierarchy includes app and environment.
- [ ] Secret JSON shape is documented.
- [ ] Typed config/secret objects validate required fields.
- [ ] Runtime role has least privilege.
- [ ] KMS permissions are explicitly tested.
- [ ] Secret values are never logged.
- [ ] Generated `toString()` does not leak secrets.

### 29.2 Runtime Checklist

- [ ] SDK clients are reused.
- [ ] Timeouts are explicit.
- [ ] Required values are validated at startup.
- [ ] Secrets are cached.
- [ ] Cache TTL matches rotation expectation.
- [ ] Refresh failure does not erase valid cached value.
- [ ] Stale secret age is observable.
- [ ] Access failure is distinguishable from malformed secret.
- [ ] Parameter fetch is batched when appropriate.
- [ ] No per-request secret/config remote read.

### 29.3 Operations Checklist

- [ ] Rotation runbook exists.
- [ ] Rollback path exists.
- [ ] DLQ/worker credentials are covered.
- [ ] Lambda static cache behavior is understood.
- [ ] EKS secret propagation model is documented.
- [ ] CloudTrail can show access history.
- [ ] Incident dashboard has secret/config load errors.
- [ ] Quotas/cost are monitored.

---

## 30. Mental Model Summary

Secrets Manager and Parameter Store are not just key-value stores.

They are runtime dependency boundaries.

A top-tier Java AWS engineer thinks in layers:

```text
classification
  -> secret or config
naming
  -> ownership, environment, IAM scope
identity
  -> which role reads it
KMS
  -> who can decrypt it
retrieval
  -> startup, lazy, refresh
cache
  -> TTL, stale-if-error, invalidation
rotation
  -> version, downstream sync, pool lifecycle
observability
  -> metrics, logs, request IDs, audit
failure
  -> missing, denied, throttled, stale, malformed
operations
  -> runbook, rollback, validation
```

The goal is not merely to hide a password.

The goal is to design a Java system where sensitive and environment-specific runtime data is:

- not hardcoded
- not leaked
- least-privileged
- auditable
- cache-efficient
- rotation-aware
- failure-aware
- operationally recoverable

That is the difference between using AWS APIs and engineering a production-grade AWS-integrated Java platform.

---

## 31. What Comes Next

Part 12 will go deeper into **KMS for Application Engineers**.

This matters because Secrets Manager, Parameter Store SecureString, S3 encryption, SQS encryption, SNS encryption, Lambda environment encryption, and auditability all eventually touch KMS.

The next part will focus on:

- key policy vs IAM policy
- envelope encryption
- data keys
- encryption context
- grants
- KMS throttling
- KMS cost
- multi-region key
- service-integrated encryption
- how Java apps should and should not call KMS directly

---

## References

- AWS Secrets Manager Java retrieval and caching: https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets-java.html
- AWS SDK for Java 2.x Secrets Manager examples: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/java_secrets-manager_code_examples.html
- AWS Secrets Manager SecretCache reference: https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_cache-java-ref_SecretCache.html
- AWS Secrets Manager version labels and secret structure: https://docs.aws.amazon.com/secretsmanager/latest/userguide/whats-in-a-secret.html
- AWS Secrets Manager UpdateSecretVersionStage API: https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_UpdateSecretVersionStage.html
- AWS Systems Manager Parameter Store: https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html
- AWS Systems Manager SecureString and KMS: https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./part-10-s3-as-integration-boundary-archive-and-event-source.md">⬅️ Part 10 — S3 as Integration Boundary, Archive, and Event Source</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./part-12-kms-for-application-engineers.md">Part 12 — KMS for Application Engineers ➡️</a>
</div>
