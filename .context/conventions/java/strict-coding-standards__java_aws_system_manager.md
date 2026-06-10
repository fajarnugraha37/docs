# Strict Coding Standards: Java + AWS Systems Manager / Parameter Store

> Status: **strict / enforceable**  
> Audience: LLM code agents, reviewers, maintainers  
> Applies with: `strict-coding-standards__java*.md`, `strict-coding-standards__java_security.md`, `strict-coding-standards__java_network.md`, `strict-coding-standards__java_telemetry.md`, `strict-coding-standards__gradle.md`, `strict-coding-standards__maven.md`

## 0. Purpose

This document is not a tutorial. It is a coding contract. An LLM implementing Java code that touches AWS must follow these rules unless the repository contains a more specific, reviewed architecture decision record.

The default posture is:

- safe by default;
- least privilege by default;
- bounded resource usage by default;
- observable failure by default;
- no hidden network, retry, credential, region, or serialization behavior.

## 1. Global LLM Contract

Before changing code, the LLM MUST identify:

1. AWS service being used.
2. AWS SDK generation and version-management mechanism.
3. region source.
4. credential source.
5. client lifecycle owner.
6. timeout and retry policy.
7. idempotency behavior.
8. data classification of payloads.
9. IAM permissions required.
10. telemetry emitted.
11. tests that prove failure behavior.

If any item is unknown, the LLM MUST mark the implementation as incomplete and add a TODO requiring human review. It MUST NOT silently invent account IDs, ARNs, regions, bucket names, topic names, queue names, KMS keys, secret names, or IAM policies.


## 2. Scope

This file defines strict rules for Java code using AWS Systems Manager, especially Parameter Store.

It applies to:

- `SsmClient`;
- `GetParameter`;
- `GetParameters`;
- `GetParametersByPath`;
- SecureString parameters;
- application configuration providers;
- runtime reload of configuration.

## 3. Parameter Store vs Secrets Manager

### MUST

- Use Parameter Store for configuration values, feature flags, paths, environment-specific settings, and low-to-moderate sensitivity secure parameters.
- Use Secrets Manager for high-value secrets requiring managed rotation, richer secret lifecycle, or secret-specific access workflows.
- Document why a sensitive value lives in Parameter Store instead of Secrets Manager.

### FORBIDDEN

- Storing frequently rotated high-value credentials in plain String parameters.
- Treating Parameter Store as a general database.
- Scanning broad paths at runtime for every request.

## 4. Client and Dependency Rules

### MUST

- Use AWS SDK for Java 2.x.
- Reuse `SsmClient`.
- Configure timeout, retry, region, and credentials.
- Wrap access behind a config provider abstraction.

### FORBIDDEN

- Creating `SsmClient` per lookup.
- Calling Parameter Store directly from domain logic.
- Hardcoding production parameter paths in library code.

## 5. Naming and Path Rules

### MUST

- Use hierarchical parameter names, for example `/app/env/service/component/key`.
- Validate path root before fetching recursively.
- Scope IAM permissions to exact path prefixes.
- Treat parameter names as external contracts.
- Avoid spaces and ambiguous names.

### FORBIDDEN

- Letting user input control parameter path.
- Recursive reads from `/` or overly broad prefixes.
- Encoding secrets or account IDs in parameter names unnecessarily.

## 6. Retrieval Rules

### MUST

- Use `GetParameter` for a known single value.
- Use `GetParameters` for a known finite set.
- Use `GetParametersByPath` only for controlled startup/config loading.
- Handle pagination for path reads.
- Validate every parameter value before use.
- Define whether decryption is required for SecureString values.

### FORBIDDEN

- Assuming `GetParametersByPath` returns all values in one call.
- Ignoring `NextToken`.
- Runtime path scan in request hot path.
- Using String parameter for secrets that require encryption.

## 7. Caching and Refresh Rules

### MUST

- Cache parameters used frequently.
- Define TTL, startup fail-fast behavior, and refresh behavior.
- Handle stale configuration intentionally.
- Avoid partial refresh causing inconsistent configuration groups.
- Validate config set atomically before swapping live config.

### FORBIDDEN

- Fetching Parameter Store on every request.
- Silently falling back to old config forever.
- Updating runtime behavior without audit/log event.

## 8. SecureString Rules

### MUST

- Use SecureString for sensitive parameters.
- Use KMS key policy intentionally.
- Grant decrypt only to required runtime roles.
- Redact values in logs and telemetry.
- Treat decrypted values like secrets in memory.

### FORBIDDEN

- Logging decrypted SecureString.
- Returning decrypted config via debug/admin endpoint.
- Broad KMS decrypt permissions.

## 9. Error Handling Rules

### MUST

- Distinguish missing parameter, invalid name, access denied, decryption failure, throttling, timeout, and malformed value.
- Fail fast for mandatory startup config.
- For optional config, use explicit defaults documented in code.

### FORBIDDEN

- Catching all errors and using empty string.
- Treating missing mandatory config as default.

## 10. Testing Rules

### MUST

- Test path building, validation, pagination, cache refresh, malformed values, denied access, and decryption failure.
- Test redaction.
- Test startup fail-fast for mandatory config.

### FORBIDDEN

- Production parameter names in tests.
- Tests that rely on developer personal AWS parameters.

## 11. Reviewer Checklist

- [ ] SSM used for config, not secretly as database.
- [ ] parameter path schema documented.
- [ ] IAM path-scoped.
- [ ] SecureString decrypted safely.
- [ ] pagination handled.
- [ ] caching and refresh behavior defined.
- [ ] malformed config fails safely.
- [ ] tests cover missing/denied/decryption/pagination.

## 12. LLM Prompt Contract

For Systems Manager/Parameter Store code, the LLM MUST state:

- parameter path schema;
- SecureString/plain String choice;
- cache and refresh behavior;
- IAM scope;
- pagination handling;
- validation rules;
- startup/runtime failure behavior.

## Source Anchors

- Systems Manager examples with AWS SDK for Java 2.x: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/java_ssm_code_examples.html
- GetParameter API: https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetParameter.html
- GetParametersByPath API: https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_GetParametersByPath.html

## Source Anchors

- AWS SDK for Java 2.x Developer Guide: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/home.html
- AWS SDK for Java 2.x best practices: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/best-practices.html
- AWS SDK for Java 2.x default credentials provider chain: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/credentials-chain.html
- AWS SDK retry behavior: https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html
- AWS SDK for Java 2.x HTTP client configuration: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/http-configuration.html
- AWS SDK for Java 2.x pagination: https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/pagination.html
- AWS Java SDK 1.x end-of-support announcement: https://aws.amazon.com/blogs/developer/announcing-end-of-support-for-aws-sdk-for-java-v1-x-on-december-31-2025/
