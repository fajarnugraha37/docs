# learn-java-authorization-modes-and-patterns-part-022  
# Part 22 — Temporal, Risk-Based, and Contextual Authorization

> Seri: **Java Authorization Modes and Patterns — Advanced Engineering**  
> File: `learn-java-authorization-modes-and-patterns-part-022.md`  
> Target: Java 8 hingga Java 25  
> Fokus: authorization yang berubah berdasarkan waktu, konteks, risiko, channel, device/network posture, session freshness, dan kondisi runtime.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 21, kita sudah membangun fondasi:

- authorization sebagai **decision system**;
- vocabulary dan invariant;
- primitive platform Java;
- PEP/PDP/PAP/PIP;
- RBAC, permission/capability, ABAC, PBAC, ReBAC, ACL;
- tenancy dan object-level authorization;
- layered enforcement;
- Spring/Jakarta authorization;
- API/messaging authorization;
- data-level query scoping;
- workflow/state-machine authorization;
- delegation, impersonation, break-glass;
- hierarchical organization dan complex role resolution.

Part ini membahas sesuatu yang lebih dinamis:

> **Apakah permission yang biasanya boleh, tetap boleh dalam konteks ini, pada waktu ini, dari channel ini, dengan risk signal ini, untuk action sensitivity ini?**

Contoh sederhana:

```text
User A punya permission case.approve.
Namun sekarang:
- request terjadi di luar jam kerja,
- dari network tidak dikenal,
- session sudah berumur 9 jam,
- action adalah final approval,
- case bernilai high-impact,
- user baru saja melakukan delegated access.

Maka hasil authorization bisa berubah dari ALLOW menjadi:
- DENY,
- STEP_UP_REQUIRED,
- REAUTHENTICATION_REQUIRED,
- REQUIRE_SECOND_APPROVER,
- ALLOW_WITH_OBLIGATION,
- ALLOW_BUT_AUDIT_HIGH_RISK.
```

Ini bukan authentication ulang semata. Ini adalah **contextual authorization**.

---

## 1. Core Mental Model

Authorization klasik sering dianggap statis:

```text
subject has permission P -> allow
```

Authorization matang berpikir seperti ini:

```text
subject S
wants action A
on resource R
under context C
with policy P
and risk signal K
at time T
using session/authentication evidence E

=> decision D
```

Secara lengkap:

```text
Decision = f(subject, action, resource, context, policy, risk, evidence, time)
```

Dengan bentuk decision yang tidak selalu boolean:

```java
enum DecisionType {
    ALLOW,
    DENY,
    STEP_UP_REQUIRED,
    REAUTHENTICATION_REQUIRED,
    REQUIRE_ADDITIONAL_APPROVAL,
    ALLOW_WITH_OBLIGATION,
    INDETERMINATE
}
```

Mental model top-level:

> **Permission menjawab “secara prinsip boleh atau tidak”. Contextual authorization menjawab “boleh atau tidak dalam situasi aktual ini”.**

---

## 2. Kenapa Contextual Authorization Penting

RBAC/ABAC/PBAC/ReBAC memberi struktur. Tetapi sistem nyata punya kondisi tambahan:

1. **Waktu**
   - hanya boleh selama masa penugasan;
   - hanya boleh pada jam operasional;
   - akses temporary expired;
   - cut-off submission.

2. **Session**
   - session terlalu lama;
   - MFA sudah terlalu lama;
   - authentication assurance kurang tinggi;
   - session berasal dari impersonation/delegation.

3. **Channel**
   - intranet vs internet;
   - web admin vs public portal;
   - API internal vs external;
   - mobile vs browser.

4. **Network/device**
   - trusted network;
   - managed device;
   - unknown device;
   - Tor/VPN/high-risk ASN;
   - impossible travel.

5. **Risk**
   - high-value transaction;
   - unusual behavior;
   - new login context;
   - privilege recently granted;
   - suspicious frequency.

6. **Resource sensitivity**
   - ordinary case vs high-profile case;
   - normal export vs bulk export;
   - public data vs restricted data;
   - draft vs final order.

7. **Operational mode**
   - maintenance window;
   - incident response;
   - read-only freeze;
   - break-glass mode;
   - data migration.

Without contextual authorization, a system may be technically correct but operationally unsafe.

---

## 3. Context Is Not a Dumping Ground

A common design failure is making `AuthorizationContext` a bag of random values:

```java
class AuthorizationContext {
    Map<String, Object> attributes;
}
```

This becomes dangerous because:

- attribute names are untyped;
- source of truth is unclear;
- freshness is unknown;
- policy depends on invisible magic strings;
- audit cannot explain why a decision happened;
- refactoring becomes risky.

Better mental model:

```text
Context must be:
- explicit,
- typed,
- source-aware,
- freshness-aware,
- minimal,
- auditable.
```

A serious context model should answer:

```text
What signal?
Who produced it?
When was it observed?
How trusted is it?
Is it mandatory or advisory?
Can it be stale?
Can user tamper with it?
```

---

## 4. Taxonomy of Contextual Authorization

### 4.1 Temporal Authorization

Rules based on time:

```text
Allow only if:
- now is within assignment window;
- submission is before deadline;
- approval happens during active case phase;
- delegated access has not expired;
- freeze period is not active;
- last MFA time is within 15 minutes for sensitive action.
```

### 4.2 Session Freshness Authorization

Rules based on age/strength of the authenticated session:

```text
Allow only if:
- session age <= max allowed;
- password authentication was recent enough;
- MFA was performed recently enough;
- user has not switched from normal to delegated role without confirmation.
```

### 4.3 Channel-Based Authorization

Rules based on access channel:

```text
Allow only if:
- administrative action is from intranet;
- public portal cannot perform agency-only command;
- bulk export disabled from mobile channel;
- support console cannot edit final decision.
```

### 4.4 Device / Network Posture Authorization

Rules based on request environment:

```text
Allow only if:
- device is managed;
- network zone is trusted;
- request is not from risky IP range;
- device posture is compliant;
- VPN/private access context exists.
```

### 4.5 Risk-Based Authorization

Rules based on risk assessment:

```text
If risk is low -> allow.
If risk is medium -> require step-up.
If risk is high -> deny or require second approval.
```

### 4.6 Sensitivity-Based Authorization

Rules based on action/resource sensitivity:

```text
Viewing normal case may require case.read.
Exporting 50,000 records may require:
- report.export.bulk,
- recent MFA,
- justification,
- privileged audit,
- manager approval.
```

### 4.7 Operational Context Authorization

Rules based on system state:

```text
If system is in read-only mode:
- allow read;
- deny create/update/delete;
- allow migration service account only for controlled maintenance task.
```

---

## 5. Temporal Authorization Deep Dive

Temporal authorization is not just:

```java
LocalDateTime.now().isBefore(deadline)
```

It requires careful modeling.

### 5.1 Types of Time Rules

| Rule Type | Example | Risk |
|---|---|---|
| Validity window | delegated role valid until Friday | timezone ambiguity |
| Deadline | submit before 2026-07-01 23:59 | inclusive/exclusive mistake |
| Business hours | approve only 08:00–18:00 | holidays and jurisdiction |
| Cooling period | cannot approve immediately after assignment | race condition |
| Freshness | MFA must be within 10 minutes | clock skew |
| Embargo | data not visible before publication date | cache leakage |
| Freeze | no mutation during maintenance window | bypass by async job |

### 5.2 Use `Instant` for Decision Time

Authorization decisions should use an explicit `Instant`.

Bad:

```java
if (LocalDateTime.now().isBefore(caseFile.getDeadline())) {
    allow();
}
```

Better:

```java
public final class AuthorizationClock {
    private final Clock clock;

    public AuthorizationClock(Clock clock) {
        this.clock = clock;
    }

    public Instant now() {
        return clock.instant();
    }
}
```

Then:

```java
Instant decisionTime = authorizationClock.now();

boolean withinWindow =
        !decisionTime.isBefore(accessWindow.validFrom()) &&
        decisionTime.isBefore(accessWindow.validUntil());
```

Why?

- testable;
- consistent across all checks;
- auditable;
- avoids multiple `now()` calls with different values;
- supports reconstructing historical decisions.

### 5.3 Use Half-Open Intervals

Prefer:

```text
[fromInclusive, untilExclusive)
```

Not:

```text
from <= now <= until
```

Reason:

- avoids overlap between adjacent windows;
- easier to reason about expiry;
- avoids double-valid boundary.

Example:

```java
public final class TimeWindow {
    private final Instant fromInclusive;
    private final Instant untilExclusive;

    public boolean contains(Instant t) {
        return !t.isBefore(fromInclusive) && t.isBefore(untilExclusive);
    }
}
```

### 5.4 Timezone Is a Business Rule

For deadlines and business hours, do not hide timezone.

```java
public final class BusinessCalendar {
    private final ZoneId zoneId;

    public boolean isWithinBusinessHours(Instant instant) {
        ZonedDateTime zdt = instant.atZone(zoneId);
        DayOfWeek day = zdt.getDayOfWeek();
        LocalTime time = zdt.toLocalTime();

        boolean weekday = day != DayOfWeek.SATURDAY && day != DayOfWeek.SUNDAY;
        boolean hours = !time.isBefore(LocalTime.of(8, 0))
                && time.isBefore(LocalTime.of(18, 0));

        return weekday && hours;
    }
}
```

This is not enough for real enterprise systems because you also need:

- public holidays;
- agency-specific working days;
- special operating day;
- emergency extension;
- daylight saving issues for non-UTC regions.

Even if Indonesia does not have DST, your system may interact with external users, Singapore, cloud logs in UTC, or cross-jurisdiction workflows. Use explicit zone.

---

## 6. Session Freshness and Step-Up Authorization

Some actions should require more recent or stronger authentication evidence.

Examples:

```text
- change email;
- assign privileged role;
- approve enforcement action;
- export bulk data;
- view highly sensitive document;
- activate break-glass access;
- impersonate user;
- submit final decision.
```

### 6.1 Authentication Strength Is Input, Not Decision

Authentication says:

```text
Who are you and how strongly did we verify you?
```

Authorization says:

```text
Given the action sensitivity, is that evidence enough?
```

So the authorization policy may say:

```text
case.approve.final requires:
- permission: case.approve.final
- session age <= 8 hours
- MFA age <= 15 minutes
- no unresolved high-risk signal
```

### 6.2 Model Authentication Evidence

Do not merely store:

```java
boolean mfa = true;
```

Better:

```java
public final class AuthenticationEvidence {
    private final Instant authenticatedAt;
    private final Instant lastMfaAt;
    private final Set<AuthFactor> factors;
    private final AssuranceLevel assuranceLevel;

    public boolean hasRecentMfa(Instant now, Duration maxAge) {
        return lastMfaAt != null && !lastMfaAt.plus(maxAge).isBefore(now);
    }
}
```

Example enum:

```java
public enum AuthFactor {
    PASSWORD,
    OTP,
    PASSKEY,
    HARDWARE_KEY,
    CLIENT_CERTIFICATE
}

public enum AssuranceLevel {
    LOW,
    MEDIUM,
    HIGH
}
```

### 6.3 Step-Up Decision

Instead of returning `DENY`, return a decision that tells the application to request additional proof.

```java
public sealed interface AuthorizationDecision
        permits Allow, Deny, StepUpRequired, ReauthenticationRequired {

    String code();
}
```

Java 8-compatible equivalent:

```java
public interface AuthorizationDecision {
    DecisionType type();
    String code();
}
```

Example:

```java
public final class StepUpRequired implements AuthorizationDecision {
    private final String code;
    private final Set<AuthFactor> requiredFactors;
    private final Duration maxAge;

    public StepUpRequired(String code, Set<AuthFactor> requiredFactors, Duration maxAge) {
        this.code = code;
        this.requiredFactors = requiredFactors;
        this.maxAge = maxAge;
    }

    @Override
    public DecisionType type() {
        return DecisionType.STEP_UP_REQUIRED;
    }

    @Override
    public String code() {
        return code;
    }
}
```

### 6.4 Spring Security MFA / Step-Up Mapping

In Spring Security, request authorization can be integrated with factors or authorities representing completed factors. Modern Spring Security documentation discusses multi-factor authentication support where authorization configuration can require additional factors for certain paths.

Conceptually:

```java
http.authorizeHttpRequests(auth -> auth
    .requestMatchers("/user/settings/**").access(requireRecentMfa())
    .requestMatchers("/cases/*/approve").access(requireFinalApprovalContext())
    .anyRequest().authenticated()
);
```

But do not put all business rules into path-level config. For domain actions, route-level step-up should be a coarse filter; service/domain policy remains the authoritative decision.

---

## 7. Channel-Based Authorization

Channel matters because the same user may access the system through different trust boundaries.

Example:

```text
Same user:
- internal admin console: can assign case;
- public internet portal: can submit own application;
- mobile channel: can view summary, cannot bulk export;
- API integration: can submit system-to-system data, cannot perform human approval.
```

### 7.1 Channel Must Be Server-Derived

Never trust:

```http
X-Channel: INTRANET
```

if the client can set it.

Better derive channel from:

- ingress/gateway;
- mTLS client identity;
- network segment;
- authenticated client registration;
- deployment boundary;
- API gateway policy;
- trusted reverse proxy metadata.

Example model:

```java
public enum AccessChannel {
    PUBLIC_WEB,
    INTERNAL_WEB,
    SYSTEM_API,
    BATCH_JOB,
    SUPPORT_CONSOLE,
    MOBILE_APP
}
```

Then:

```java
public final class RequestContext {
    private final AccessChannel channel;
    private final NetworkZone networkZone;
    private final String requestId;
    private final String clientId;
}
```

### 7.2 Channel Is Not a Substitute for Permission

Bad:

```java
if (channel == INTERNAL_WEB) allowApprove();
```

Better:

```text
Allow only if:
- user has case.approve permission,
- user is assigned reviewer,
- case is in REVIEW_PENDING,
- channel is INTERNAL_WEB,
- session is fresh enough,
- no SoD violation.
```

Channel is a constraint, not full authorization.

### 7.3 Channel-Based Policy Examples

```text
Policy: Bulk export
ALLOW if:
- subject has report.export.bulk,
- channel is INTERNAL_WEB or SYSTEM_API,
- network zone is TRUSTED,
- MFA age <= 15 minutes,
- export size <= approved limit,
- justification exists.

DENY if:
- channel is PUBLIC_WEB,
- channel is MOBILE_APP,
- break-glass session is active but export is unrelated to emergency.
```

---

## 8. Network and Device Posture Authorization

Modern authorization often considers device and network posture.

Examples:

```text
- Is the device managed?
- Is endpoint protection healthy?
- Is disk encryption enabled?
- Is request from corporate/private network?
- Is the IP reputation high-risk?
- Is there impossible travel?
- Is there a suspicious ASN?
```

### 8.1 Treat Posture as Evidence With Confidence

Device posture can be stale or forged if poorly sourced.

Model:

```java
public final class DevicePosture {
    private final String deviceId;
    private final boolean managed;
    private final boolean compliant;
    private final Instant observedAt;
    private final PostureSource source;
    private final Confidence confidence;
}
```

```java
public enum Confidence {
    LOW,
    MEDIUM,
    HIGH
}
```

### 8.2 Posture Freshness

```java
public boolean isFresh(Instant now, Duration maxAge) {
    return !observedAt.plus(maxAge).isBefore(now);
}
```

A posture signal from 3 days ago should not authorize a sensitive action today.

### 8.3 Network Zone

```java
public enum NetworkZone {
    PUBLIC_INTERNET,
    CORPORATE_VPN,
    PRIVATE_NETWORK,
    CLOUD_INTERNAL,
    UNKNOWN
}
```

Example rule:

```text
case.approve.final requires networkZone in [CORPORATE_VPN, PRIVATE_NETWORK].
```

But beware: network zone alone is weak. A compromised machine inside VPN is still dangerous. Contextual authorization is strongest when signals are combined.

---

## 9. Risk-Based Authorization

Risk-based authorization evaluates whether current access is abnormal or too dangerous.

### 9.1 Risk Score Is Not Magic

A risk score is useful only when it has:

- source;
- timestamp;
- reason codes;
- confidence;
- actionability;
- threshold policy;
- audit meaning.

Bad:

```java
if (riskScore < 80) allow();
```

Better:

```java
public final class RiskAssessment {
    private final RiskLevel level;
    private final int score;
    private final Set<RiskReason> reasons;
    private final Instant assessedAt;
    private final String modelVersion;
    private final Confidence confidence;
}
```

```java
public enum RiskLevel {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}

public enum RiskReason {
    NEW_DEVICE,
    NEW_COUNTRY,
    IMPOSSIBLE_TRAVEL,
    HIGH_VALUE_ACTION,
    RECENT_PRIVILEGE_GRANT,
    UNUSUAL_EXPORT_VOLUME,
    PRIVILEGED_SESSION,
    THREAT_INTEL_MATCH
}
```

### 9.2 Risk Decision Table

| Risk Level | Normal Read | Sensitive Read | Final Approval | Bulk Export | Break-Glass |
|---|---:|---:|---:|---:|---:|
| LOW | Allow | Allow | Allow if policy passes | Allow with audit | Allow if approved |
| MEDIUM | Allow | Step-up | Step-up | Step-up + justification | Manager approval |
| HIGH | Step-up | Deny or step-up + manager | Deny | Deny | Security approval |
| CRITICAL | Deny | Deny | Deny | Deny | Deny except emergency protocol |

### 9.3 Risk-Based Does Not Replace Least Privilege

Risk-based authorization is an additional control.

Bad:

```text
High trust user can bypass permission.
```

Better:

```text
Permission is still required.
Low risk may reduce friction.
High risk may add obligations or deny.
```

---

## 10. Sensitive Action Re-Authorization

Some actions should force re-authorization or reauthentication even if user is already logged in.

### 10.1 Examples

```text
- delete case;
- final approval;
- reject appeal;
- change payee/bank detail;
- assign system admin;
- export personal data;
- grant delegated authority;
- activate break-glass;
- view sealed document;
- bulk download attachments.
```

### 10.2 Sensitivity Model

```java
public enum ActionSensitivity {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}
```

```java
public final class ActionDescriptor {
    private final String action;
    private final ActionSensitivity sensitivity;
    private final boolean mutating;
    private final boolean irreversible;
    private final boolean bulk;
}
```

Policy:

```java
public final class SensitiveActionPolicy {
    public AuthorizationDecision evaluate(
            Subject subject,
            ActionDescriptor action,
            AuthenticationEvidence evidence,
            RiskAssessment risk,
            Instant now
    ) {
        if (action.sensitivity() == ActionSensitivity.CRITICAL
                && !evidence.hasRecentMfa(now, Duration.ofMinutes(10))) {
            return Decisions.stepUp("RECENT_MFA_REQUIRED");
        }

        if (risk.level() == RiskLevel.HIGH || risk.level() == RiskLevel.CRITICAL) {
            return Decisions.deny("RISK_TOO_HIGH");
        }

        return Decisions.allow();
    }
}
```

### 10.3 Reauthorization vs Step-Up

| Concept | Meaning |
|---|---|
| Reauthorization | Re-evaluate whether the action is allowed |
| Reauthentication | Ask user to prove identity again |
| Step-up | Ask for stronger/recent factor |
| Confirmation | Ask user to confirm intent |
| Approval | Ask another actor/system to approve |

Do not mix these terms.

---

## 11. Immutable Context Snapshot

A subtle but important top 1% practice:

> The authorization decision should be based on an immutable snapshot of context.

Bad design:

```java
if (policy.canApprove(user, caseId)) {
    Case c = repository.findById(caseId);
    c.approve();
}
```

Between check and mutation:

- case state may change;
- assignment may change;
- delegation may expire;
- risk may update;
- user may lose permission;
- case may become locked.

Better:

```java
@Transactional
public void approveCase(ApproveCaseCommand command) {
    CaseFile caseFile = caseRepository.findForUpdate(command.caseId());

    AuthorizationContextSnapshot snapshot =
            contextFactory.createSnapshot(command.subject(), command.requestContext(), caseFile);

    AuthorizationDecision decision =
            authorizationService.authorize(command.subject(), Actions.CASE_APPROVE_FINAL, caseFile, snapshot);

    decision.requireAllowed();

    caseFile.approve(command.reason(), snapshot.decisionTime());
}
```

Important:

```text
Load resource state and authorize within the same transaction when mutation depends on resource state.
```

For high-risk state transitions, use locking or version checks:

```java
@Version
private long version;
```

or:

```sql
SELECT ... FOR UPDATE
```

depending on DB and persistence strategy.

---

## 12. TOCTOU in Contextual Authorization

TOCTOU = Time Of Check To Time Of Use.

### 12.1 Example

```text
1. User checks "can approve case".
2. System returns allow.
3. Another user changes case to CLOSED.
4. First user submits approve.
5. If system does not re-check, invalid transition happens.
```

### 12.2 Authorization Must Happen at Command Execution

UI may ask:

```text
Can this button be shown?
```

But command must still enforce:

```text
Can this action be executed now?
```

Button-level authorization is **advisory UX**.

Command-level authorization is **real enforcement**.

### 12.3 TOCTOU Defense

Use:

- re-check at mutation boundary;
- transaction boundary;
- optimistic locking;
- pessimistic locking for critical flow;
- version precondition;
- immutable context snapshot;
- final state transition guard;
- audit the decision.

---

## 13. Java Context Model: Production-Grade Skeleton

### 13.1 Core Context Types

Java 8-compatible:

```java
public final class AuthorizationContext {
    private final Instant decisionTime;
    private final AccessChannel channel;
    private final NetworkZone networkZone;
    private final AuthenticationEvidence authenticationEvidence;
    private final DevicePosture devicePosture;
    private final RiskAssessment riskAssessment;
    private final OperationalMode operationalMode;
    private final Map<String, ContextAttribute<?>> attributes;

    public AuthorizationContext(
            Instant decisionTime,
            AccessChannel channel,
            NetworkZone networkZone,
            AuthenticationEvidence authenticationEvidence,
            DevicePosture devicePosture,
            RiskAssessment riskAssessment,
            OperationalMode operationalMode,
            Map<String, ContextAttribute<?>> attributes
    ) {
        this.decisionTime = Objects.requireNonNull(decisionTime);
        this.channel = Objects.requireNonNull(channel);
        this.networkZone = Objects.requireNonNull(networkZone);
        this.authenticationEvidence = authenticationEvidence;
        this.devicePosture = devicePosture;
        this.riskAssessment = riskAssessment;
        this.operationalMode = Objects.requireNonNull(operationalMode);
        this.attributes = Collections.unmodifiableMap(new LinkedHashMap<String, ContextAttribute<?>>(attributes));
    }

    public Instant decisionTime() {
        return decisionTime;
    }

    public AccessChannel channel() {
        return channel;
    }

    public NetworkZone networkZone() {
        return networkZone;
    }

    public AuthenticationEvidence authenticationEvidence() {
        return authenticationEvidence;
    }

    public RiskAssessment riskAssessment() {
        return riskAssessment;
    }

    public OperationalMode operationalMode() {
        return operationalMode;
    }

    public Optional<ContextAttribute<?>> attribute(String name) {
        return Optional.ofNullable(attributes.get(name));
    }
}
```

Java 17+ variant can use records:

```java
public record AuthorizationContext(
        Instant decisionTime,
        AccessChannel channel,
        NetworkZone networkZone,
        AuthenticationEvidence authenticationEvidence,
        DevicePosture devicePosture,
        RiskAssessment riskAssessment,
        OperationalMode operationalMode,
        Map<String, ContextAttribute<?>> attributes
) {}
```

### 13.2 Attribute With Provenance

```java
public final class ContextAttribute<T> {
    private final String name;
    private final T value;
    private final AttributeSource source;
    private final Instant observedAt;
    private final Confidence confidence;
    private final boolean userControlled;

    public ContextAttribute(
            String name,
            T value,
            AttributeSource source,
            Instant observedAt,
            Confidence confidence,
            boolean userControlled
    ) {
        this.name = Objects.requireNonNull(name);
        this.value = value;
        this.source = Objects.requireNonNull(source);
        this.observedAt = Objects.requireNonNull(observedAt);
        this.confidence = Objects.requireNonNull(confidence);
        this.userControlled = userControlled;
    }

    public boolean isFresh(Instant now, Duration maxAge) {
        return !observedAt.plus(maxAge).isBefore(now);
    }
}
```

### 13.3 Do Not Trust User-Controlled Context

Policy should reject critical decisions based on user-controlled attributes.

```java
if (attribute.isUserControlled() && action.isSensitive()) {
    return Decisions.indeterminate("UNTRUSTED_CONTEXT_ATTRIBUTE");
}
```

Examples of dangerous user-controlled attributes:

```text
- tenantId from request body;
- channel from header;
- role from hidden form;
- agencyId from query parameter;
- client IP when proxy chain is not trusted;
- device ID from raw browser localStorage.
```

---

## 14. Context Factory Pattern

Do not let every controller construct context manually.

```java
public interface AuthorizationContextFactory {
    AuthorizationContext create(
            Subject subject,
            HttpServletRequest request,
            ResourceRef resourceRef
    );
}
```

Example:

```java
public final class DefaultAuthorizationContextFactory implements AuthorizationContextFactory {
    private final Clock clock;
    private final ChannelResolver channelResolver;
    private final NetworkZoneResolver networkZoneResolver;
    private final RiskService riskService;
    private final DevicePostureService devicePostureService;

    @Override
    public AuthorizationContext create(
            Subject subject,
            HttpServletRequest request,
            ResourceRef resourceRef
    ) {
        Instant now = clock.instant();

        AccessChannel channel = channelResolver.resolve(request);
        NetworkZone networkZone = networkZoneResolver.resolve(request);
        RiskAssessment risk = riskService.assess(subject, resourceRef, request, now);
        DevicePosture posture = devicePostureService.resolve(subject, request, now);

        return AuthorizationContextBuilder.create()
                .decisionTime(now)
                .channel(channel)
                .networkZone(networkZone)
                .riskAssessment(risk)
                .devicePosture(posture)
                .operationalMode(OperationalMode.NORMAL)
                .build();
    }
}
```

The factory centralizes:

- trusted source extraction;
- fallback behavior;
- freshness rules;
- audit fields;
- request correlation;
- masking of untrusted headers.

---

## 15. Operational Mode Authorization

Operational mode is often forgotten.

```java
public enum OperationalMode {
    NORMAL,
    READ_ONLY,
    MAINTENANCE,
    INCIDENT_RESPONSE,
    DATA_MIGRATION,
    DISASTER_RECOVERY
}
```

Policy example:

```java
public final class OperationalModePolicy implements Policy {
    @Override
    public AuthorizationDecision evaluate(AuthorizationRequest request) {
        OperationalMode mode = request.context().operationalMode();

        if (mode == OperationalMode.READ_ONLY && request.action().isMutating()) {
            return Decisions.deny("SYSTEM_READ_ONLY");
        }

        if (mode == OperationalMode.DATA_MIGRATION
                && !request.subject().isServiceAccount("migration-worker")) {
            return Decisions.deny("MIGRATION_MODE_RESTRICTED");
        }

        return Decisions.abstain();
    }
}
```

Operational mode must be:

- controlled by trusted ops/admin process;
- audited;
- time-bound;
- visible to operators;
- included in decision log.

---

## 16. Combining Contextual Policies

A realistic decision may combine:

```text
Base permission policy
AND tenant policy
AND object-level policy
AND workflow-state policy
AND temporal policy
AND risk policy
AND channel policy
AND operational-mode policy
```

### 16.1 Decision Combiner

Common approaches:

| Combiner | Meaning |
|---|---|
| Deny-overrides | any deny wins |
| Permit-overrides | any allow wins |
| First-applicable | first matching policy decides |
| Consensus | multiple policies vote |
| Weighted risk | risk score changes result |

For security-sensitive authorization, prefer:

```text
Deny-overrides + explicit allow
```

Example:

```java
public final class DenyOverridesCombiner {
    public AuthorizationDecision combine(List<AuthorizationDecision> decisions) {
        for (AuthorizationDecision d : decisions) {
            if (d.type() == DecisionType.DENY) {
                return d;
            }
        }

        for (AuthorizationDecision d : decisions) {
            if (d.type() == DecisionType.STEP_UP_REQUIRED
                    || d.type() == DecisionType.REAUTHENTICATION_REQUIRED
                    || d.type() == DecisionType.REQUIRE_ADDITIONAL_APPROVAL) {
                return d;
            }
        }

        boolean hasAllow = false;
        for (AuthorizationDecision d : decisions) {
            if (d.type() == DecisionType.ALLOW) {
                hasAllow = true;
            }
        }

        return hasAllow ? Decisions.allow() : Decisions.deny("NO_EXPLICIT_ALLOW");
    }
}
```

### 16.2 Why Step-Up Should Usually Beat Allow

If base permission says allow but risk policy says step-up:

```text
Final decision should be STEP_UP_REQUIRED, not ALLOW.
```

If risk policy says deny:

```text
Final decision should be DENY.
```

Ordering matters.

---

## 17. Contextual Authorization and Caching

Caching contextual decisions is dangerous.

### 17.1 Cache Key Must Include Context

Bad:

```text
key = subjectId + action + resourceId
```

This ignores:

- time;
- risk;
- channel;
- MFA freshness;
- device posture;
- operational mode;
- delegation state.

Better:

```text
key = subjectId
    + action
    + resourceId
    + tenantId
    + policyVersion
    + contextClass
    + channel
    + networkZone
    + riskBucket
    + authFreshnessBucket
```

Even then, decision cache TTL should be short for contextual decisions.

### 17.2 Do Not Cache Across Sensitivity Boundary

Do not reuse:

```text
allow case.read.summary
```

for:

```text
case.read.fullSensitiveDocument
```

Do not reuse:

```text
allow normal read
```

for:

```text
bulk export
```

### 17.3 Prefer Caching Inputs Over Decisions

Often safer:

- cache subject permissions;
- cache role resolution;
- cache org hierarchy;
- cache device posture for short TTL;
- cache risk assessment for short TTL;
- then recompute final decision.

This gives better correctness than caching final allow/deny.

---

## 18. Data Model for Temporal and Contextual Rules

### 18.1 Delegated Access Table

```sql
CREATE TABLE delegated_authority (
    id                  BIGINT PRIMARY KEY,
    principal_user_id   VARCHAR(64) NOT NULL,
    acting_user_id      VARCHAR(64) NOT NULL,
    scope_type          VARCHAR(64) NOT NULL,
    scope_id            VARCHAR(128),
    valid_from_utc      TIMESTAMP NOT NULL,
    valid_until_utc     TIMESTAMP NOT NULL,
    reason              VARCHAR(1000) NOT NULL,
    approved_by         VARCHAR(64),
    status              VARCHAR(32) NOT NULL,
    created_at_utc      TIMESTAMP NOT NULL,
    revoked_at_utc      TIMESTAMP NULL
);
```

Invariant:

```text
valid_from_utc < valid_until_utc
status ACTIVE only if now in [valid_from, valid_until)
revoked_at_utc null for active delegation
```

### 18.2 Sensitive Action Challenge Table

```sql
CREATE TABLE sensitive_action_challenge (
    id                  BIGINT PRIMARY KEY,
    user_id             VARCHAR(64) NOT NULL,
    action              VARCHAR(128) NOT NULL,
    resource_type       VARCHAR(64) NOT NULL,
    resource_id         VARCHAR(128) NOT NULL,
    challenge_type      VARCHAR(64) NOT NULL,
    satisfied_at_utc    TIMESTAMP NULL,
    expires_at_utc      TIMESTAMP NOT NULL,
    status              VARCHAR(32) NOT NULL,
    correlation_id      VARCHAR(128) NOT NULL
);
```

Used for:

- step-up challenge;
- recent reauthentication;
- explicit confirmation;
- manager approval.

### 18.3 Operational Mode Table

```sql
CREATE TABLE system_operational_mode (
    id                  BIGINT PRIMARY KEY,
    mode                VARCHAR(64) NOT NULL,
    scope               VARCHAR(128) NOT NULL,
    valid_from_utc      TIMESTAMP NOT NULL,
    valid_until_utc     TIMESTAMP NOT NULL,
    reason              VARCHAR(1000) NOT NULL,
    activated_by        VARCHAR(64) NOT NULL,
    approved_by         VARCHAR(64),
    created_at_utc      TIMESTAMP NOT NULL
);
```

Do not store operational mode as only in-memory config if it affects access decisions and audit.

---

## 19. API Design

### 19.1 Authorization Request

```java
public final class AuthorizationRequest {
    private final Subject subject;
    private final ActionDescriptor action;
    private final ResourceRef resource;
    private final AuthorizationContext context;

    // constructor/getters omitted
}
```

### 19.2 Decision Response

```java
public final class PolicyDecision {
    private final DecisionType type;
    private final String code;
    private final String safeMessage;
    private final List<DecisionReason> reasons;
    private final List<Obligation> obligations;
    private final Instant decidedAt;
    private final String policyVersion;
}
```

### 19.3 Obligations

Obligations are actions the PEP must perform when enforcing an allow/step-up.

Examples:

```text
- log high-risk access;
- require justification;
- mask fields;
- watermark export;
- notify manager;
- expire session after action;
- disallow batch retry;
- attach reason to audit event.
```

Java:

```java
public final class Obligation {
    private final String code;
    private final Map<String, String> parameters;
}
```

### 19.4 Example Decision

```json
{
  "type": "STEP_UP_REQUIRED",
  "code": "RECENT_MFA_REQUIRED_FOR_BULK_EXPORT",
  "reasons": [
    "ACTION_SENSITIVITY_HIGH",
    "MFA_TOO_OLD"
  ],
  "obligations": [
    {
      "code": "AUDIT_ATTEMPT",
      "parameters": {
        "severity": "HIGH"
      }
    }
  ],
  "policyVersion": "authorization-policy-2026.06.19"
}
```

---

## 20. UI/UX Implications

Contextual authorization affects user journey.

Bad UX:

```text
User fills 10-page form, clicks submit, then sees "Forbidden".
```

Better:

- pre-check eligibility;
- show reason early when safe;
- disable action with explanation;
- allow step-up inline;
- preserve user input after step-up;
- show when delegation/session expired;
- avoid leaking existence of hidden resources.

### 20.1 Safe Denial Messages

For resource existence-sensitive actions:

```text
"You do not have access to this resource."
```

For workflow/user-owned visible actions:

```text
"This case can no longer be approved because it is already closed."
```

For step-up:

```text
"Additional verification is required before exporting this report."
```

### 20.2 Do Not Leak Risk Signals Excessively

Bad:

```text
Denied because your IP is flagged by threat intelligence and impossible travel detected.
```

Better:

```text
"Additional verification is required due to security policy."
```

Log detailed reason internally.

---

## 21. Testing Contextual Authorization

### 21.1 Test Matrix

| Dimension | Cases |
|---|---|
| Time | before valid, at start, inside, at end, after expiry |
| Timezone | UTC, local zone, cross-zone deadline |
| Session | fresh, stale, MFA fresh, MFA stale |
| Risk | low, medium, high, critical |
| Channel | public, internal, mobile, system API |
| Device | compliant, non-compliant, stale posture |
| Network | trusted, untrusted, unknown |
| Operational mode | normal, read-only, maintenance |
| Resource sensitivity | normal, sensitive, bulk, irreversible |
| Delegation | active, expired, revoked, out-of-scope |

### 21.2 Boundary Tests for Time

```java
@Test
void delegationIsInvalidAtUntilBoundary() {
    Instant from = Instant.parse("2026-06-01T00:00:00Z");
    Instant until = Instant.parse("2026-06-10T00:00:00Z");

    TimeWindow window = new TimeWindow(from, until);

    assertTrue(window.contains(from));
    assertTrue(window.contains(Instant.parse("2026-06-09T23:59:59Z")));
    assertFalse(window.contains(until));
}
```

### 21.3 Step-Up Tests

```java
@Test
void finalApprovalRequiresRecentMfa() {
    AuthenticationEvidence evidence = evidenceWithMfaAt(
            Instant.parse("2026-06-19T08:00:00Z")
    );

    Instant now = Instant.parse("2026-06-19T08:30:01Z");

    AuthorizationDecision decision = policy.evaluate(
            subjectWith("case.approve.final"),
            finalApprovalAction(),
            evidence,
            lowRisk(),
            now
    );

    assertEquals(DecisionType.STEP_UP_REQUIRED, decision.type());
}
```

### 21.4 TOCTOU Tests

Test that final command re-checks authorization after state changes.

```java
@Test
void approvalFailsIfCaseStateChangedAfterButtonPrecheck() {
    // precheck says allowed
    assertTrue(uiAuthorization.canShowApproveButton(user, caseId));

    // another transaction closes case
    caseRepository.close(caseId);

    // command must re-check and fail
    assertThrows(AccessDeniedException.class, () ->
            caseCommandService.approve(user, caseId)
    );
}
```

---

## 22. Observability and Audit

Contextual authorization needs audit because decisions depend on changing signals.

### 22.1 Decision Log Fields

At minimum:

```text
- decision_id
- correlation_id
- subject_id
- actor_id if delegated/impersonated
- action
- resource_type
- resource_id or masked resource ref
- tenant/org/agency
- decision type
- reason codes
- policy version
- decision time
- channel
- network zone
- risk level
- risk reason codes
- authentication evidence class, not secrets
- MFA age bucket
- device posture status
- operational mode
- obligations emitted
- PEP location
```

### 22.2 Do Not Log Secrets

Never log:

- raw access token;
- password;
- OTP;
- full session cookie;
- private key;
- complete sensitive document;
- excessive PII unless required and protected.

### 22.3 Historical Reconstruction

For regulatory defensibility, you may need to answer:

```text
Why was user U allowed to approve case C on date T?
```

You need:

- policy version;
- subject role/permission snapshot or reconstructable history;
- assignment state;
- case state;
- context snapshot;
- decision log;
- audit trail for delegation/step-up.

If you only log:

```text
ALLOW
```

you cannot reconstruct defensibility.

---

## 23. Failure Modes

### 23.1 Context Missing

What if risk service is unavailable?

Options:

```text
- fail closed for high-risk action;
- allow low-risk read with degraded audit;
- require step-up;
- use cached risk if fresh enough;
- deny if context is mandatory.
```

Decision table:

| Action Sensitivity | Risk Service Down | Recommended |
|---|---|---|
| Low read | Missing | Allow with degraded audit |
| Normal update | Missing | Step-up or deny depending domain |
| Final approval | Missing | Deny or require manual override |
| Bulk export | Missing | Deny |
| Break-glass | Missing | Dedicated emergency flow |

### 23.2 Stale Context

A stale signal is not equivalent to safe signal.

```text
device_compliant observed 7 days ago
```

should not authorize:

```text
bulk export today
```

### 23.3 Overly Aggressive Risk Rules

If risk engine creates too much friction:

- users find workarounds;
- support load spikes;
- emergency overrides get abused;
- business flow degrades.

Design with:

- clear thresholds;
- user-friendly step-up;
- audit;
- exception review;
- metrics.

### 23.4 User-Controlled Context Injection

Example:

```http
X-Network-Zone: INTERNAL
X-Device-Compliant: true
```

Never use those headers unless set and validated by trusted infrastructure.

### 23.5 Context Drift Between Services

In microservices, Service A may think:

```text
channel = INTERNAL
```

while Service B sees:

```text
channel = PUBLIC
```

Solve with:

- signed/trusted context envelope;
- internal gateway;
- mTLS workload identity;
- consistent context resolver;
- decision at resource-owning service;
- context snapshot propagation.

---

## 24. Context Envelope for Distributed Systems

In distributed systems, you may need to propagate contextual evidence.

But never blindly trust propagated context.

### 24.1 Context Envelope Fields

```json
{
  "subject": "user-123",
  "actor": "user-456",
  "channel": "INTERNAL_WEB",
  "networkZone": "PRIVATE_NETWORK",
  "authTime": "2026-06-19T08:00:00Z",
  "mfaTime": "2026-06-19T08:42:00Z",
  "riskLevel": "LOW",
  "issuedAt": "2026-06-19T08:45:00Z",
  "issuer": "api-gateway",
  "correlationId": "..."
}
```

### 24.2 Trust Requirements

Context envelope should be:

- issued by trusted component;
- time-bound;
- signed or transmitted over authenticated internal channel;
- scoped to audience/service;
- not accepted from public clients;
- validated by receiving service.

### 24.3 Still Re-Check Resource State

Even if context is trusted, resource-level authorization still belongs to resource-owning service.

---

## 25. Spring Implementation Sketch

### 25.1 Custom AuthorizationManager for Coarse Context

```java
public final class ContextualRequestAuthorizationManager
        implements AuthorizationManager<RequestAuthorizationContext> {

    private final AuthorizationContextFactory contextFactory;
    private final AuthorizationService authorizationService;

    @Override
    public AuthorizationDecision check(
            Supplier<Authentication> authentication,
            RequestAuthorizationContext object
    ) {
        Authentication auth = authentication.get();
        HttpServletRequest request = object.getRequest();

        Subject subject = SubjectMapper.from(auth);
        ResourceRef resource = ResourceRef.fromRequest(request);
        AuthorizationContext context =
                contextFactory.create(subject, request, resource);

        PolicyDecision decision = authorizationService.authorize(
                subject,
                ActionDescriptor.fromRequest(request),
                resource,
                context
        );

        return new AuthorizationDecision(decision.isAllowed());
    }
}
```

Caveat:

- this works for route/resource hints;
- service/domain method still must enforce actual resource-level action.

### 25.2 Method-Level Contextual Policy

```java
@Service
public class CaseApprovalService {
    private final AuthorizationService authorizationService;
    private final AuthorizationContextFactory contextFactory;
    private final CaseRepository caseRepository;

    @Transactional
    public void approveFinal(Subject subject, ApproveFinalCommand command) {
        CaseFile caseFile = caseRepository.findForUpdate(command.caseId());

        AuthorizationContext context =
                contextFactory.createForCommand(subject, command, caseFile);

        PolicyDecision decision = authorizationService.authorize(
                subject,
                Actions.CASE_APPROVE_FINAL,
                caseFile.toResourceRef(),
                context
        );

        decision.requireAllowed();

        caseFile.approveFinal(subject.id(), command.reason(), context.decisionTime());
    }
}
```

This is where final enforcement belongs.

---

## 26. Java 8–25 Version Notes

### Java 8

Use:

- immutable classes manually;
- `java.time`;
- `Optional` carefully;
- no sealed types;
- no records;
- explicit builders.

### Java 11

Mostly same design, but better runtime baseline for long-term services.

### Java 17

Useful for:

- records for context snapshots;
- sealed interfaces for decision types;
- pattern matching improvements;
- stronger domain modeling.

### Java 21

Useful for:

- virtual threads for high-concurrency PDP calls;
- structured concurrency if available in selected runtime mode;
- better operational throughput for authorization service calls.

But do not make authorization correctness depend on virtual threads.

### Java 25

Use modern language/runtime features only where they improve clarity and maintainability. The core security model remains the same:

```text
explicit context + explicit policy + deny-by-default + auditable decision
```

---

## 27. Practical Design Checklist

Before implementing contextual authorization, answer:

```text
1. Which actions are sensitive?
2. Which context signals are mandatory?
3. Which signals are advisory?
4. Which signals are user-controlled?
5. Which signals are trusted infrastructure-derived?
6. How fresh must each signal be?
7. What happens if signal source is unavailable?
8. Which actions require recent MFA?
9. Which actions require reauthentication?
10. Which actions require second approval?
11. What is the deny/step-up/allow decision table?
12. Is the final command re-checking authorization?
13. Is decision context immutable?
14. Is decision logged with policy version?
15. Can we reconstruct historical decisions?
16. Is cache key context-aware?
17. Can async jobs bypass the rule?
18. Can report/export/search bypass the rule?
19. Can a client spoof channel/network/tenant/device?
20. Are denial messages safe?
```

---

## 28. Mini Capstone: Final Case Approval Policy

### 28.1 Requirement

A user may final-approve an enforcement case only if:

```text
- user has permission case.approve.final;
- user is assigned reviewer or authorized delegated reviewer;
- user is not the submitter;
- case state is REVIEW_PENDING;
- case belongs to user's agency scope;
- action is from internal web or system API;
- session age <= 8 hours;
- MFA age <= 15 minutes;
- risk is LOW or MEDIUM;
- if risk is MEDIUM, step-up is required;
- if case is high impact, require second approver;
- system is not in READ_ONLY mode;
- decision is audited.
```

### 28.2 Decision Flow

```text
approveFinal(command)
  -> load case with lock
  -> build immutable context snapshot
  -> evaluate base permission
  -> evaluate scope/tenant
  -> evaluate SoD
  -> evaluate state transition
  -> evaluate channel
  -> evaluate session freshness
  -> evaluate MFA freshness
  -> evaluate risk
  -> evaluate high-impact obligation
  -> combine decisions
  -> enforce result
  -> mutate case
  -> write audit
```

### 28.3 Policy Pseudocode

```java
public PolicyDecision authorizeFinalApproval(
        Subject subject,
        CaseFile caseFile,
        AuthorizationContext context
) {
    DecisionBuilder out = DecisionBuilder.start();

    if (!subject.hasPermission("case.approve.final")) {
        return out.deny("MISSING_PERMISSION");
    }

    if (!caseFile.isInAgencyScope(subject.agencyId())) {
        return out.deny("OUT_OF_AGENCY_SCOPE");
    }

    if (!caseFile.isReviewPending()) {
        return out.deny("INVALID_CASE_STATE");
    }

    if (caseFile.submittedBy().equals(subject.userId())) {
        return out.deny("MAKER_CHECKER_VIOLATION");
    }

    if (!caseFile.isAssignedReviewer(subject.userId())
            && !subject.hasActiveDelegationFor(caseFile.id(), context.decisionTime())) {
        return out.deny("NOT_ASSIGNED_OR_DELEGATED");
    }

    if (context.operationalMode() == OperationalMode.READ_ONLY) {
        return out.deny("SYSTEM_READ_ONLY");
    }

    if (!(context.channel() == AccessChannel.INTERNAL_WEB
            || context.channel() == AccessChannel.SYSTEM_API)) {
        return out.deny("CHANNEL_NOT_ALLOWED");
    }

    if (!context.authenticationEvidence()
            .hasRecentMfa(context.decisionTime(), Duration.ofMinutes(15))) {
        return out.stepUp("RECENT_MFA_REQUIRED");
    }

    RiskLevel risk = context.riskAssessment().level();

    if (risk == RiskLevel.HIGH || risk == RiskLevel.CRITICAL) {
        return out.deny("RISK_TOO_HIGH");
    }

    if (risk == RiskLevel.MEDIUM) {
        return out.stepUp("RISK_BASED_STEP_UP_REQUIRED");
    }

    if (caseFile.isHighImpact()) {
        return out.allowWithObligation(
                "SECOND_APPROVER_REQUIRED",
                Obligation.of("REQUIRE_SECOND_APPROVER")
        );
    }

    return out.allow("FINAL_APPROVAL_ALLOWED");
}
```

---

## 29. Top 1% Insight

Junior implementation:

```java
@PreAuthorize("hasRole('APPROVER')")
public void approve(...) {}
```

Intermediate implementation:

```java
@PreAuthorize("hasAuthority('case.approve.final')")
public void approve(...) {}
```

Senior implementation:

```text
permission + assignment + state + tenant + SoD + context + risk + audit
```

Top 1% implementation:

```text
Authorization is a time-bound, context-bound, evidence-based, auditable decision.
The system does not ask only:
"Does this user have permission?"

It asks:
"Given this subject, action, resource, state, context, evidence,
risk, policy version, and decision time,
is this operation defensible if reviewed later?"
```

This is the difference between access control as code and authorization as engineering.

---

## 30. Summary

Key takeaways:

1. Contextual authorization modifies or constrains normal permission decisions.
2. Time, session freshness, channel, network, device posture, risk, sensitivity, and operational mode can all affect access.
3. Context must be explicit, typed, trusted, freshness-aware, and auditable.
4. Step-up is not the same as deny.
5. Reauthorization must happen at command execution, not only at UI pre-check.
6. TOCTOU is a major failure mode in contextual authorization.
7. Risk score must have reason, source, confidence, and policy mapping.
8. Sensitive actions need stronger evidence and sometimes second approval.
9. Cache contextual decisions very carefully.
10. For regulatory systems, decision reconstruction is a first-class requirement.

---

## 31. Referensi

Referensi resmi/otoritatif yang relevan untuk bagian ini:

1. OWASP Authorization Cheat Sheet — least privilege, deny-by-default, validate authorization on every request, attribute/relationship-based guidance.  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

2. OWASP Top 10 2021 — A01 Broken Access Control.  
   https://owasp.org/Top10/2021/A01_2021-Broken_Access_Control/

3. NIST SP 800-207 — Zero Trust Architecture; policy decision/enforcement concepts and contextual access evaluation.  
   https://csrc.nist.gov/publications/detail/sp/800-207/final

4. NIST Digital Identity Guidelines SP 800-63-4 — current digital identity guidelines, including authentication assurance concepts that become input to authorization/step-up decisions.  
   https://pages.nist.gov/800-63-4/

5. Spring Security Reference — Servlet authorization and `AuthorizationManager`.  
   https://docs.spring.io/spring-security/reference/servlet/authorization/architecture.html

6. Spring Security Reference — Multi-Factor Authentication support and factor-based authorization configuration.  
   https://docs.spring.io/spring-security/reference/servlet/authentication/mfa.html

7. Java Platform `java.time` package — recommended time API for explicit, testable decision time modeling.  
   https://docs.oracle.com/javase/8/docs/api/java/time/package-summary.html

---

## 32. Status Seri

Selesai sampai:

```text
[x] Part 0  — Authorization Mental Model
[x] Part 1  — Authorization Vocabulary, Semantics, and Invariants
[x] Part 2  — Java Platform Authorization Primitives
[x] Part 3  — Authorization Architecture Patterns: PEP, PDP, PAP, PIP
[x] Part 4  — RBAC Done Properly
[x] Part 5  — Permission and Capability Modeling
[x] Part 6  — ABAC
[x] Part 7  — PBAC and Policy-as-Code
[x] Part 8  — ReBAC
[x] Part 9  — ACL and Domain Object Security
[x] Part 10 — Resource Ownership, Tenancy, and Data Boundary Enforcement
[x] Part 11 — IDOR, BOLA, and Object-Level Authorization
[x] Part 12 — Authorization in Layered Java Applications
[x] Part 13 — Spring Security Authorization: Servlet Stack Deep Dive
[x] Part 14 — Spring Method Security: Service-Level Authorization
[x] Part 15 — Spring Domain Authorization Patterns
[x] Part 16 — Jakarta EE / Jakarta Security / Jakarta Authorization
[x] Part 17 — Authorization in REST APIs, GraphQL, gRPC, and Messaging
[x] Part 18 — Data-Level Authorization and Query Scoping
[x] Part 19 — Workflow, State Machine, and Case Management Authorization
[x] Part 20 — Delegation, Impersonation, Acting Roles, and Break-Glass Access
[x] Part 21 — Hierarchical Organizations and Complex Role Resolution
[x] Part 22 — Temporal, Risk-Based, and Contextual Authorization
```

Seri belum selesai.

Part berikutnya:

```text
Part 23 — Authorization for Microservices and Distributed Systems
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authorization-modes-and-patterns-part-021.md">⬅️ Java Authorization Modes and Patterns — Part 21</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authorization-modes-and-patterns-part-023.md">Part 23 — Authorization for Microservices and Distributed Systems ➡️</a>
</div>
