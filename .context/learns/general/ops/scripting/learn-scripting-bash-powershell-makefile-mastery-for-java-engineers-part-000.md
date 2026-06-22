# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-000

# Part 000 — Orientation: Scripting as Engineering Control Plane

> Series: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Audience: Java software engineer / tech lead  
> Scope: Bash, POSIX shell, PowerShell, Makefile, and production-grade automation engineering  
> Status: Part 000 of 029

---

## 0. Why This Part Exists

Most engineers learn scripting backwards.

They start from commands:

```bash
cd app
mvn test
docker build -t service .
kubectl apply -f deployment.yaml
```

Then they wrap those commands into a file:

```bash
#!/usr/bin/env bash
mvn test
docker build -t service .
kubectl apply -f deployment.yaml
```

Then the script grows:

```bash
#!/usr/bin/env bash
set -e

ENV=$1
VERSION=$2

mvn test
docker build -t service:$VERSION .
docker push registry/service:$VERSION
kubectl --namespace $ENV set image deployment/service service=registry/service:$VERSION
```

Then one day it fails in CI, works locally, breaks on macOS, deletes the wrong folder, leaks a secret into logs, deploys the wrong version, or silently ignores an error in the middle of a pipeline.

The problem is not that Bash, PowerShell, or Make are bad.

The problem is that scripting is often treated as “small code” instead of “control plane code.”

This series starts from the opposite premise:

> Scripting is software engineering applied to operational control.

A script can compile code, delete data, create users, rotate credentials, deploy services, migrate schemas, collect incident evidence, package releases, or mutate production infrastructure. Even a 20-line script may have a wider blast radius than a 20,000-line backend service.

So Part 000 is not about memorizing syntax. It is about building the correct mental model before touching syntax.

By the end of this part, you should understand:

1. What scripting is actually for.
2. Why shell scripts fail differently from application code.
3. How Bash, POSIX shell, PowerShell, and Makefile fit together.
4. When not to write a script.
5. What “top 1%” scripting skill looks like in real engineering systems.
6. The risk model that should shape every automation decision.
7. The learning map for the rest of the series.

---

## 1. Scripting Is Not “Small Programming”

A common mistake is to classify code by size:

| Code type | Misleading assumption |
|---|---|
| Java service | Serious engineering |
| Shell script | Small helper |
| Makefile | Developer convenience |
| CI YAML | Configuration only |
| PowerShell script | Admin utility |

This mental model is dangerous.

The better classification is by **control authority**.

A script may control:

- build execution,
- test orchestration,
- package creation,
- release tagging,
- artifact publishing,
- production deployment,
- database migration invocation,
- environment bootstrap,
- incident diagnostics,
- secret access,
- cloud resource mutation,
- local developer setup,
- CI/CD execution,
- cross-platform operational workflows.

That means scripting frequently sits at the boundary between:

```text
Human intent -> automation -> system mutation
```

This is why scripting deserves architectural thinking.

A script is not just a list of commands. A script is an executable interpretation of operational intent.

---

## 2. A More Useful Definition of Scripting

For this series, we define scripting as:

> Scripting is the practice of composing existing programs, files, processes, environment state, operating system facilities, and external services into repeatable workflows.

That definition matters because scripts rarely compute everything themselves.

A Java backend often owns its domain logic internally:

```text
HTTP request -> controller -> service -> repository -> database
```

A script usually orchestrates external actors:

```text
script
  -> shell parser
  -> environment variables
  -> filesystem
  -> process execution
  -> external commands
  -> network services
  -> credentials
  -> CI runtime
  -> deployment target
```

That means a script's correctness depends not only on its source code, but also on everything around it.

A Java method may fail because of bad internal logic.

A script may fail because:

- the current directory is different,
- `PATH` resolves a different binary,
- the target command version changed,
- a variable contains spaces,
- a filename starts with `-`,
- globbing expands unexpectedly,
- `stdout` and `stderr` are mixed,
- a pipeline hides failure,
- `set -e` behaves differently than expected,
- a script runs under `/bin/sh` instead of Bash,
- CI uses Linux but developers use macOS or Windows,
- a secret is missing,
- a remote API is flaky,
- the script assumes interactive TTY input,
- the script is run twice and is not idempotent,
- the script mutates the wrong environment.

So scripting skill is largely the skill of controlling boundaries.

---

## 3. The Four Core Technologies in This Series

This series covers four major automation surfaces:

1. POSIX shell
2. Bash
3. PowerShell
4. Makefile

They overlap, but they are not interchangeable.

### 3.1 POSIX Shell

POSIX shell is the portability baseline for Unix-like systems.

Its role:

- smallest common shell layer,
- good for minimal containers,
- good for portable bootstrap scripts,
- useful when `/bin/bash` is not guaranteed,
- useful for scripts that must run on many Unix-like environments.

Its weakness:

- limited data structures,
- subtle syntax,
- weak ergonomics for complex logic,
- poor structured data handling,
- less convenient than Bash for many tasks.

Use POSIX shell when portability matters more than expressiveness.

Example use cases:

```text
install.sh
entrypoint.sh
small CI bootstrap
container startup script
minimal preflight script
```

### 3.2 Bash

Bash is a powerful Unix shell and command language. It is widely available in Linux environments and common in developer tooling, CI systems, containers, and operational scripts.

Its role:

- practical Unix automation,
- process orchestration,
- text stream handling,
- filesystem workflows,
- developer tooling,
- CI command wrappers,
- operational scripts,
- glue around commands like `mvn`, `gradle`, `docker`, `git`, `kubectl`, `curl`, `jq`.

Its weakness:

- surprising parsing and expansion rules,
- fragile quoting if misunderstood,
- poor native structured data model,
- many failure modes are implicit,
- portability differences across systems,
- easy to write scripts that look correct but fail on edge cases.

Use Bash when Unix process composition is the main job.

Example use cases:

```text
scripts/test.sh
scripts/release.sh
scripts/diagnostics.sh
scripts/build-image.sh
scripts/local-dev.sh
```

### 3.3 PowerShell

PowerShell is a cross-platform automation language built around objects, pipelines, command discovery, and .NET integration.

Its role:

- Windows automation,
- cross-platform administrative automation,
- object-based pipelines,
- structured data manipulation,
- cloud/admin scripting,
- enterprise environments,
- automation that benefits from .NET APIs,
- workflows where object properties matter more than text parsing.

Its weakness:

- less universally available in minimal Unix containers,
- syntax and semantics differ significantly from POSIX/Bash,
- external native command interop requires care,
- can be verbose for simple Unix tasks,
- object formatting can mislead beginners.

Use PowerShell when object automation, Windows compatibility, .NET access, or cross-platform admin scripting is important.

Example use cases:

```text
scripts/Verify-Environment.ps1
scripts/Publish-Artifact.ps1
scripts/Collect-Diagnostics.ps1
scripts/Invoke-Release.ps1
```

### 3.4 Makefile

Make is not primarily a shell scripting language. It is a dependency graph executor.

Its role:

- define targets,
- express dependencies,
- provide consistent developer commands,
- wrap build/test/package workflows,
- coordinate generated files,
- create a thin facade over Maven, Gradle, Docker, scripts, and CI.

Its weakness:

- unusual syntax,
- tabs matter,
- variable expansion can surprise people,
- shell behavior inside recipes is often misunderstood,
- can become unreadable when abused as a general scripting language.

Use Makefile when you need a stable command interface and dependency-oriented workflow orchestration.

Example use cases:

```makefile
make test
make build
make docker-build
make verify
make release
make diagnostics
```

---

## 4. The Control Plane Mental Model

In distributed systems, the control plane configures or directs behavior. The data plane handles the actual user or business traffic.

For example:

```text
Data plane:
  - application request handling
  - database query execution
  - message consumption
  - HTTP response generation

Control plane:
  - deployment
  - scaling
  - configuration
  - migration
  - release
  - observability setup
  - incident response command
```

Scripting usually lives in the control plane.

A script often says:

```text
Build this.
Test this.
Package this.
Publish this.
Deploy this.
Clean this.
Collect this.
Rotate this.
Verify this.
```

That gives it operational power.

The top-level implication:

> A script must be designed according to the damage it can cause, not according to the number of lines it contains.

A 10-line script that runs `rm -rf "$TARGET"` needs more defensive design than a 500-line data transformation tool that only reads files.

---

## 5. Why Scripting Feels Easy but Becomes Hard

Scripting feels easy because the first version is usually linear:

```bash
mvn test
docker build -t service .
docker run service
```

It becomes hard because real automation requires handling variation:

```text
Which OS?
Which shell?
Which command version?
Which working directory?
Which environment?
Which credentials?
Which target cluster?
Which failure mode?
Which retry policy?
Which logs should be kept?
Which data is safe to print?
What happens if the script is interrupted?
What happens if it runs twice?
What happens if it partially succeeds?
What happens if two people run it concurrently?
```

Most script failures come from unstated assumptions.

For example:

```bash
rm -rf $BUILD_DIR
```

Looks simple.

But what are the assumptions?

```text
BUILD_DIR is set.
BUILD_DIR is not empty.
BUILD_DIR does not contain spaces.
BUILD_DIR does not begin with dash.
BUILD_DIR points to the intended directory.
BUILD_DIR is not `/`.
The caller has permission.
No other process is using it.
The command is running in the expected environment.
The script should really delete recursively.
```

A safer mindset is:

```bash
: "${BUILD_DIR:?BUILD_DIR is required}"

case "$BUILD_DIR" in
  /|"")
    echo "Refusing to delete unsafe BUILD_DIR: '$BUILD_DIR'" >&2
    exit 1
    ;;
esac

rm -rf -- "$BUILD_DIR"
```

This is not about paranoia. It is about making assumptions executable.

---

## 6. Script Correctness Is Different from Application Correctness

As a Java engineer, you are used to reasoning about:

- types,
- classes,
- method contracts,
- exceptions,
- dependency injection,
- unit tests,
- transactions,
- concurrency,
- APIs,
- observability,
- deployment pipelines.

Those concepts still matter, but scripting exposes different primitives:

| Java/service thinking | Scripting equivalent |
|---|---|
| Method return value | Exit code |
| Exception | Non-zero status / error stream / thrown error record |
| Function argument | CLI argument / env var / file / stdin |
| Object | Text line, JSON object, PowerShell object, file artifact |
| Classpath dependency | PATH dependency / installed binary |
| Transaction | Idempotent operation + rollback/compensation |
| Logger | stdout/stderr discipline + log levels |
| Config object | env/config file/flags |
| Interface contract | CLI contract |
| Integration test | script run against fake/temp environment |
| Deployment safety | preflight + confirmation + dry-run + target verification |

A strong automation engineer translates familiar engineering concerns into scripting primitives.

---

## 7. The Automation Boundary Model

Every script has boundaries. You should identify them before writing code.

### 7.1 Input Boundaries

A script may receive input from:

- command-line arguments,
- environment variables,
- config files,
- stdin,
- current directory,
- existing files,
- command output,
- remote APIs,
- CI variables,
- secrets manager,
- user prompts.

Each input source has risk.

Command-line arguments may contain spaces, glob characters, newlines, or leading dashes.

Environment variables may be missing, stale, inherited, or accidentally leaked.

Current directory may not be what you expect.

Remote APIs may be unavailable, slow, paginated, or inconsistent.

Secrets may accidentally appear in logs.

### 7.2 Execution Boundaries

A script executes commands:

```text
script -> shell -> external process -> OS/network/filesystem
```

Each external command is a dependency.

You need to know:

- Is the command installed?
- Which version?
- Does it behave the same across OSes?
- Is its output stable?
- Does it print errors to stderr?
- Does it return non-zero when it fails?
- Can it partially succeed?
- Is it safe to retry?
- Does it mutate state?

### 7.3 Output Boundaries

A script produces:

- stdout,
- stderr,
- exit code,
- files,
- artifacts,
- logs,
- network changes,
- deployment changes,
- database changes,
- cloud resource mutations.

A good script has explicit output contracts.

For example:

```text
stdout: machine-readable JSON only
stderr: human-readable logs
exit 0: success
exit 1: validation failure
exit 2: external dependency failure
exit 3: unsafe target refused
```

That may sound formal, but it makes automation composable.

---

## 8. Shell as Process Orchestrator

Shell scripting is not mainly about implementing algorithms.

It is about orchestrating processes.

A shell command generally does this:

```text
parse command line
expand variables/globs/substitutions
set up file descriptors
find executable
fork/exec process
wait for completion
collect exit status
```

This explains many shell surprises.

For example:

```bash
files="*.txt"
echo "$files"
```

prints:

```text
*.txt
```

But:

```bash
echo $files
```

may expand to matching filenames, depending on shell expansion behavior.

The shell is not passing strings the way Java passes strings. It is interpreting command language syntax and producing argv arrays for external processes.

That is why quoting matters.

A command is not “a string.”

A command is eventually an executable plus arguments:

```text
argv[0] = "rm"
argv[1] = "-rf"
argv[2] = "--"
argv[3] = "/some/path with spaces"
```

Good shell scripting is often about preserving the intended argument boundaries.

---

## 9. Bash vs PowerShell: Text Pipeline vs Object Pipeline

Bash and PowerShell both have pipelines, but they do not pass the same kind of data.

### 9.1 Bash Pipeline

In Bash and POSIX shells, pipeline composition is usually text stream composition:

```bash
ps aux | grep java | awk '{print $2}'
```

Each command receives bytes/text and emits bytes/text.

This is extremely powerful for Unix tools, but fragile when output is meant for humans rather than machines.

Human output may change:

```text
column order changes
spacing changes
locale changes
headers change
formatting changes
```

Structured tools help:

```bash
some-cli output --json | jq -r '.items[].id'
```

### 9.2 PowerShell Pipeline

PowerShell pipelines pass objects:

```powershell
Get-Process | Where-Object { $_.ProcessName -like "java*" } | Select-Object Id, ProcessName
```

The next command receives structured objects with properties.

This changes the mental model:

```text
Bash: parse text carefully.
PowerShell: transform objects carefully.
```

PowerShell can still call native commands and process text, but its strength is object automation.

### 9.3 Practical Decision

Use Bash when the workflow is naturally Unix-process/text/file oriented.

Use PowerShell when the workflow is naturally object/API/admin/.NET oriented.

Use JSON as a boundary when they need to interoperate.

---

## 10. Makefile Is a Graph, Not a Script

A Makefile can run shell commands, but Make itself is not “just shell.”

Make thinks in targets and prerequisites:

```makefile
app.jar: src/Main.java
	mvn package
```

The core question Make asks is:

```text
What target do you want, and what needs to exist or be newer before that target can be considered up to date?
```

This is different from a shell script, which asks:

```text
What commands should run in this order?
```

Make is useful because many engineering workflows are dependency-shaped:

```text
verify -> lint + test + security-check
build -> verify + compile + package
docker-image -> build + Dockerfile
release -> verify + build + docker-image + publish
```

For Java projects, Make often works best as a stable facade:

```bash
make test
make verify
make build
make docker-build
make release
```

Underneath, it can call Maven, Gradle, Bash, PowerShell, Docker, or other tools.

The trap is turning Makefile into a giant unreadable shell script. Make should orchestrate workflows; detailed imperative logic often belongs in scripts.

---

## 11. The Tool Selection Framework

Before writing automation, ask this:

> What is the smallest safe tool for this workflow?

Not the smallest tool. The smallest safe tool.

### 11.1 Use POSIX Shell When

Use POSIX shell when:

- script must run almost anywhere Unix-like,
- environment is minimal,
- dependencies must be near-zero,
- logic is simple,
- portability matters more than expressiveness.

Avoid POSIX shell when:

- you need arrays,
- structured data is central,
- error handling is complex,
- large reusable libraries are needed,
- long-term maintainability matters more than minimal runtime.

### 11.2 Use Bash When

Use Bash when:

- Linux/Unix environment is expected,
- command orchestration is dominant,
- you need arrays/functions/stronger shell ergonomics,
- you are wrapping tools,
- local dev and CI are Unix-like,
- script complexity is moderate.

Avoid Bash when:

- data transformation is complex,
- strong typing would reduce risk,
- object APIs are central,
- Windows-first compatibility is required,
- logic grows into application territory.

### 11.3 Use PowerShell When

Use PowerShell when:

- Windows support matters,
- object pipelines are useful,
- .NET APIs are useful,
- admin/cloud automation is central,
- structured data is common,
- cross-platform scripting is desired with explicit runtime availability.

Avoid PowerShell when:

- target environment is minimal Linux container without PowerShell,
- team familiarity is extremely low,
- Unix-native commands are all you need,
- startup/runtime availability is a concern.

### 11.4 Use Makefile When

Use Makefile when:

- you want a standard developer command interface,
- workflows are target/dependency oriented,
- local and CI commands should match,
- you want to hide incidental command complexity but not business logic,
- you need a simple entrypoint: `make verify`, `make build`, `make release`.

Avoid Makefile when:

- you need complex branching logic,
- you need rich argument parsing,
- the Makefile becomes hundreds of lines of shell embedded in recipes,
- another build tool already models the workflow better.

### 11.5 Use Java, Go, Python, or Node Instead When

Do not force shell scripting when the problem is really software.

Use a real application language when:

- data model is complex,
- error handling needs rich structure,
- concurrency is non-trivial,
- portability is critical,
- long-term maintainability matters,
- you need libraries and tests,
- you need APIs, persistence, or complex state transitions,
- the script has grown beyond orchestration into domain logic.

A top engineer is not someone who can write everything in Bash.

A top engineer knows when Bash should stop.

---

## 12. Scripting Risk Model

To write production-grade scripts, classify risk explicitly.

### 12.1 Mutation Risk

Read-only scripts are safer than mutating scripts.

```text
Low mutation risk:
  collect logs
  print environment diagnostics
  validate config
  check versions

Medium mutation risk:
  create local build directory
  generate code
  package artifact
  update local cache

High mutation risk:
  delete directories
  publish artifacts
  deploy services
  rotate credentials
  modify production config
  run database migration command
  change cloud resources
```

The higher the mutation risk, the more guardrails you need.

Guardrails include:

- explicit target selection,
- dry-run mode,
- confirmation gate,
- environment verification,
- idempotency,
- rollback plan,
- lock acquisition,
- audit logs,
- least privilege credentials,
- clear failure messages.

### 12.2 Scope Risk

A script that touches one temp directory is lower risk than a script that touches many services.

Scope dimensions:

```text
local machine
CI workspace
shared artifact registry
development environment
staging environment
production environment
multi-region infrastructure
multi-tenant system
```

The same command changes risk depending on scope.

```bash
rm -rf build/
```

is usually fine.

```bash
rm -rf "$TARGET_PREFIX"
```

could be catastrophic if `TARGET_PREFIX` points to shared data.

### 12.3 Reversibility Risk

Can the operation be undone?

```text
Easy to reverse:
  recreate temp directory
  rerun code generation
  rebuild artifact

Hard to reverse:
  delete remote data
  overwrite release artifact
  mutate production config
  rotate credentials incorrectly
  run irreversible migration
```

Irreversible operations require stronger validation.

### 12.4 Concurrency Risk

What happens if two instances run at the same time?

Potential failures:

- both write same file,
- one deletes while another reads,
- both publish same version,
- deployment races,
- lock file stale,
- partial artifact consumed by another process.

Mitigations:

- lock files,
- atomic writes,
- unique temp directories,
- immutable artifact names,
- idempotent operations,
- server-side compare-and-swap if available.

### 12.5 Secrecy Risk

Scripts often touch secrets.

Risks:

- printing secrets in logs,
- passing secrets as command-line arguments visible in process list,
- writing secrets to temp files,
- failing with debug traces enabled,
- storing secrets in shell history,
- accidentally uploading diagnostic bundles containing credentials.

Rule:

> Treat logs as potentially durable and widely visible.

Never casually echo secrets.

### 12.6 Environment Drift Risk

Scripts depend on environment.

Examples:

- different Bash versions,
- different GNU/BSD utilities,
- different PowerShell versions,
- different Make versions,
- different `sed`/`awk` behavior,
- different Docker CLI behavior,
- different current directory,
- different locale,
- different timezone,
- different line endings,
- different filesystem case sensitivity.

A script should either normalize its environment or fail with a clear message.

---

## 13. Production-Grade Script Invariants

A production-grade script should maintain invariants.

An invariant is a condition that should always hold if the script is correct.

### 13.1 Target Invariant

The script must operate on the intended target.

Examples:

```text
The deployment target must be explicitly selected.
The namespace must match the environment.
The registry must match the release channel.
The branch must be allowed for release.
The version must not already exist unless overwrite is explicit.
```

### 13.2 Input Invariant

Required inputs must be present and valid before mutation begins.

Examples:

```text
VERSION is required.
ENVIRONMENT must be one of dev/staging/prod.
CONFIG_FILE must exist.
JAVA_HOME must point to an installed JDK.
Required command must be available.
```

### 13.3 Safety Invariant

The script must refuse unsafe operations.

Examples:

```text
Refuse to delete `/`.
Refuse empty target path.
Refuse production deploy without explicit flag.
Refuse dirty working tree for release.
Refuse unknown cluster context.
```

### 13.4 Observability Invariant

The script must make failure understandable.

Examples:

```text
Print what target is being operated on.
Print high-level steps.
Print command dependency validation.
Separate logs from machine-readable output.
Return meaningful exit status.
Preserve diagnostic files when failure occurs.
```

### 13.5 Idempotency Invariant

Where possible, running the script twice should be safe.

Examples:

```text
Creating an existing directory should not fail unnecessarily.
Re-generating code should produce same output.
Publishing existing version should fail clearly or skip intentionally.
Deploying same artifact should be no-op or explicit redeploy.
```

### 13.6 Cleanup Invariant

Temporary state should be cleaned up or intentionally preserved for debugging.

Examples:

```text
Temp directory removed on success.
Temp directory preserved on failure if debug mode is enabled.
Lock released on exit.
Partial artifact not left under final name.
```

---

## 14. The Script Lifecycle

A script has a lifecycle, just like application code.

### 14.1 Ad Hoc Command

Starts as a manual command:

```bash
mvn -q test
```

At this stage, it is personal knowledge.

### 14.2 Shell History Pattern

Repeated command appears in shell history:

```bash
mvn -q test && docker build -t service:local .
```

At this stage, it is implicit workflow.

### 14.3 Local Script

Command becomes a script:

```bash
scripts/build-local.sh
```

At this stage, it is reusable but may still be informal.

### 14.4 Team Tool

Other engineers start using it.

Now it needs:

- help text,
- argument validation,
- stable behavior,
- clear logs,
- error handling,
- documentation.

### 14.5 CI/CD Contract

CI depends on it.

Now it needs:

- deterministic exit codes,
- non-interactive behavior,
- artifact paths,
- cache behavior,
- environment validation.

### 14.6 Operational Control Tool

It mutates shared or production systems.

Now it needs:

- guardrails,
- auditability,
- dry-run,
- target verification,
- least privilege,
- rollback/compensation,
- incident-friendly logs.

Many teams fail because scripts reach stage 5 or 6 while still being written as stage 2 commands.

---

## 15. A Taxonomy of Scripts

Not all scripts deserve the same engineering weight.

### 15.1 Personal Helper Script

Used by one person.

Characteristics:

- low blast radius,
- informal interface,
- may assume local machine state,
- limited documentation.

Still avoid dangerous habits like unquoted variables and unsafe deletion.

### 15.2 Project Helper Script

Used by team members.

Characteristics:

- should be committed to repo,
- should have usage text,
- should validate dependencies,
- should be easy to run from repo root,
- should avoid personal machine assumptions.

### 15.3 CI Script

Used by pipeline.

Characteristics:

- non-interactive,
- deterministic,
- clear exit code,
- emits artifacts predictably,
- handles CI environment variables,
- avoids relying on hidden local state.

### 15.4 Release Script

Used to produce or publish versions.

Characteristics:

- high correctness requirement,
- version validation,
- immutable artifact thinking,
- tag/release consistency,
- clear rollback/abort behavior,
- audit trail.

### 15.5 Deployment Script

Used to mutate runtime environments.

Characteristics:

- target verification,
- environment guardrails,
- preflight checks,
- dry-run/plan,
- progressive rollout if relevant,
- failure detection,
- rollback/compensation.

### 15.6 Incident Script

Used during operational pressure.

Characteristics:

- must be safe under stress,
- should default to read-only,
- should collect useful evidence,
- should redact secrets,
- should be time-bounded,
- should produce postmortem-friendly output.

---

## 16. Scripting as Interface Design

A script is often an interface between humans and systems.

Bad interface:

```bash
./deploy.sh prod true false x 3
```

What do those arguments mean?

Better interface:

```bash
./deploy.sh \
  --environment prod \
  --version 1.42.0 \
  --strategy rolling \
  --require-clean-git \
  --dry-run
```

Good script interfaces are:

- explicit,
- discoverable,
- difficult to misuse,
- stable over time,
- consistent with team conventions,
- friendly to both humans and CI.

A script should answer:

```bash
./deploy.sh --help
```

with useful information.

Help text is not decoration. It is part of the API.

---

## 17. Scripting as Failure Design

Most scripting tutorials show success paths.

Production scripting is mostly failure design.

Ask:

```text
What can fail before mutation?
What can fail during mutation?
What can fail after partial success?
What should be retried?
What must not be retried?
What should be cleaned up?
What should be preserved for debugging?
What should the user see?
What should CI see?
What should the logs contain?
What must never appear in logs?
```

A naive script says:

```bash
deploy
```

A robust script says:

```text
1. Validate arguments.
2. Validate required tools.
3. Validate credentials exist without printing them.
4. Validate target environment.
5. Validate artifact exists.
6. Print plan.
7. Refuse unsafe target unless explicit confirmation exists.
8. Execute mutation.
9. Verify outcome.
10. Emit summary.
11. Cleanup temporary state.
12. Exit with meaningful status.
```

This sequencing matters.

Validation should happen before mutation.

---

## 18. The “Local Works, CI Fails” Pattern

A major purpose of scripting is to remove ambiguity between local and CI behavior.

Common drift:

| Local | CI |
|---|---|
| interactive TTY | non-interactive |
| cached dependencies | clean workspace |
| user credentials | service credentials |
| macOS | Linux |
| newer tool version | pinned image version |
| dirty working tree | clean checkout |
| custom shell profile | minimal shell |
| local env vars | CI-provided env vars |

A good project eventually converges on:

```bash
make verify
```

working both locally and in CI.

The Makefile or script becomes the contract.

CI YAML should often be thin:

```yaml
steps:
  - run: make verify
  - run: make package
```

Instead of duplicating complex logic in CI config.

Why?

Because developers can run the same command locally before pushing.

---

## 19. Scripting and Java Projects

As a Java engineer, your automation often wraps:

- Maven,
- Gradle,
- JDK selection,
- test execution,
- code generation,
- Docker image build,
- dependency checks,
- API client generation,
- integration test startup,
- local service orchestration,
- artifact publication,
- release tagging,
- deployment commands,
- diagnostics collection.

The goal is not to replace Maven or Gradle.

The goal is to provide a coherent operating interface around the project.

Example:

```text
Developer intent:
  “verify this project is safe to merge”

Make target:
  make verify

Underlying actions:
  check required tools
  run formatter check
  run unit tests
  run integration tests
  run static analysis
  build artifact
```

This creates a stable workflow vocabulary.

Instead of telling every engineer:

```bash
Run this Maven profile, then this Docker command, but only after exporting these variables, unless you are on Windows, and remember to clean the generated directory first.
```

You give them:

```bash
make verify
```

and make the automation encode the workflow.

---

## 20. Layering: Keep Each Tool in Its Proper Role

A clean automation architecture uses layers.

Example project layout:

```text
service/
  Makefile
  scripts/
    lib/
      common.sh
      logging.sh
      safety.sh
    verify.sh
    build-image.sh
    release.sh
    diagnostics.sh
    Verify-Environment.ps1
    Collect-Diagnostics.ps1
  pom.xml
  Dockerfile
  .github/
    workflows/
      ci.yml
```

Possible responsibilities:

```text
Makefile:
  user-facing workflow facade

Bash scripts:
  Unix command orchestration

PowerShell scripts:
  cross-platform/admin/object automation

Maven/Gradle:
  Java build lifecycle

CI YAML:
  runner wiring, secrets binding, trigger policy
```

Bad layering:

```text
CI YAML contains 200 lines of business workflow.
Makefile contains 300 lines of embedded shell.
Bash script implements complex JSON transformation manually.
PowerShell script wraps simple Unix command without need.
Maven profile runs deployment side effects unexpectedly.
```

Good layering keeps each tool honest.

---

## 21. The Automation Maturity Model

You can evaluate scripting maturity in levels.

### Level 0 — Manual Commands

Knowledge lives in people's heads or chat messages.

Symptoms:

- “Run these commands in order.”
- Different engineers do different things.
- CI does not match local behavior.

### Level 1 — Basic Scripts

Commands are captured.

Symptoms:

- scripts work for the author,
- minimal validation,
- poor error handling,
- assumptions are implicit.

### Level 2 — Team Scripts

Scripts are usable by others.

Symptoms:

- help text,
- repo-root handling,
- dependency checks,
- consistent logs,
- basic safety guards.

### Level 3 — CI-Compatible Scripts

Scripts become pipeline contracts.

Symptoms:

- deterministic,
- non-interactive,
- clear exit codes,
- artifacts are predictable,
- CI and local commands align.

### Level 4 — Production-Safe Automation

Scripts can mutate shared systems safely.

Symptoms:

- dry-run,
- target validation,
- audit logs,
- secret safety,
- idempotency,
- rollback/compensation,
- concurrency controls.

### Level 5 — Platform-Grade Automation

Automation becomes a maintained internal product.

Symptoms:

- versioned modules/libraries,
- testing strategy,
- documentation,
- compatibility policy,
- onboarding path,
- observability,
- incident integration,
- deprecation process.

Top 1% scripting is mostly Level 4 and Level 5 thinking.

---

## 22. What Makes a Script “Professional”

A professional script is not necessarily long or clever.

It is:

1. Clear about intent.
2. Explicit about inputs.
3. Conservative about mutation.
4. Honest about failure.
5. Stable as an interface.
6. Understandable under pressure.
7. Safe with secrets.
8. Portable where it claims to be portable.
9. Testable enough for its risk level.
10. Maintained like real code.

A professional script optimizes for the next engineer who runs it during a stressful moment.

---

## 23. What Makes a Script Dangerous

A dangerous script often has these properties:

```bash
#!/bin/bash
set -e
rm -rf $DIR
for x in $(cat files.txt); do
  do_something $x
done
curl https://example.com/install.sh | bash
kubectl config use-context prod
kubectl delete pod $POD
```

Problems:

- unquoted variables,
- unsafe deletion,
- word splitting bugs,
- unsafe command execution from network,
- implicit production context mutation,
- no validation,
- no dry-run,
- no target verification,
- poor failure reporting.

Dangerous scripts are not always obviously dangerous. They are often normal-looking scripts with hidden assumptions.

---

## 24. Good Automation Is Boring

Clever scripting is usually a liability.

Bad goal:

```text
Make this one-liner elegant.
```

Better goal:

```text
Make this workflow safe, obvious, repeatable, and debuggable.
```

One-liners are useful interactively. Production scripts should prefer clarity.

Example one-liner:

```bash
for s in $(cat services.txt); do kubectl rollout restart deploy/$s; done
```

More boring but safer:

```bash
while IFS= read -r service; do
  [ -n "$service" ] || continue
  case "$service" in \#*) continue ;; esac
  echo "Restarting deployment: $service" >&2
  kubectl rollout restart "deployment/$service"
done < services.txt
```

The second version is less flashy, but it preserves line boundaries and is easier to reason about.

---

## 25. The Role of Standards and Official Documentation

This series will lean on official references for language behavior:

- POSIX Shell Command Language for portable shell semantics.
- GNU Bash Reference Manual for Bash behavior.
- Microsoft PowerShell documentation for object pipeline, language behavior, and command semantics.
- GNU Make manual for Makefile semantics.

This matters because shell behavior is full of edge cases. Blog-post folklore is useful, but official semantics are the anchor.

For example:

- POSIX defines shell command language behavior for `sh`.
- Bash implements many features beyond POSIX and has cases where default Bash behavior differs from POSIX mode.
- PowerShell pipelines pass objects, not merely text.
- GNU Make evaluates targets, prerequisites, variables, and recipes under its own expansion rules before invoking a shell for recipe lines.

You do not need to memorize every page of these manuals. But you need to know which reference governs which behavior.

---

## 26. The “Script Contract” Template

Before writing any non-trivial script, describe its contract.

Use this template:

```text
Name:
  What is the script called?

Purpose:
  What operational intent does it implement?

Inputs:
  CLI args, env vars, files, stdin, external services.

Outputs:
  stdout, stderr, files, artifacts, mutations, exit codes.

Dependencies:
  Required commands, versions, OS assumptions.

Mutation:
  What state can it change?

Safety:
  What does it refuse to do?

Idempotency:
  What happens if it runs twice?

Concurrency:
  What happens if two instances run?

Secrets:
  What secrets does it need and how are they protected?

Failure:
  What are expected failure modes and how are they reported?

Recovery:
  What should the operator do after partial failure?
```

This may feel heavy for tiny scripts. Use judgment.

But for build, release, deployment, migration, and incident scripts, this thinking prevents expensive mistakes.

---

## 27. Example: From Fragile Script to Engineered Script

### 27.1 Fragile Version

```bash
#!/bin/bash
set -e

ENV=$1
VERSION=$2

mvn test
docker build -t my-service:$VERSION .
docker push registry.example.com/my-service:$VERSION
kubectl -n $ENV set image deployment/my-service my-service=registry.example.com/my-service:$VERSION
```

This is common.

Hidden assumptions:

- `ENV` is provided.
- `VERSION` is provided.
- `ENV` is safe.
- current Kubernetes context is correct.
- Docker registry is correct.
- version does not already exist.
- Maven uses correct JDK.
- `docker push` succeeds fully.
- deployment update is verified.
- production deploy requires no extra confirmation.
- no secret appears in logs.

### 27.2 More Engineered Shape

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  release-deploy.sh --environment ENV --version VERSION [--dry-run]

Required:
  --environment  dev|staging|prod
  --version      semantic version or build version

Options:
  --dry-run      print planned actions without mutating deployment target
USAGE
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

ENVIRONMENT=""
VERSION=""
DRY_RUN=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --environment)
      ENVIRONMENT="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[ -n "$ENVIRONMENT" ] || die "--environment is required"
[ -n "$VERSION" ] || die "--version is required"

case "$ENVIRONMENT" in
  dev|staging|prod) ;;
  *) die "Invalid environment: $ENVIRONMENT" ;;
esac

require_cmd mvn
require_cmd docker
require_cmd kubectl

IMAGE="registry.example.com/my-service:$VERSION"

echo "Plan:" >&2
echo "  Environment: $ENVIRONMENT" >&2
echo "  Version:     $VERSION" >&2
echo "  Image:       $IMAGE" >&2
echo "  Dry-run:     $DRY_RUN" >&2

if [ "$DRY_RUN" = true ]; then
  echo "Dry-run mode: no mutation will be performed." >&2
  exit 0
fi

mvn test
docker build -t "$IMAGE" .
docker push "$IMAGE"
kubectl -n "$ENVIRONMENT" set image deployment/my-service "my-service=$IMAGE"
kubectl -n "$ENVIRONMENT" rollout status deployment/my-service
```

This is still not perfect. But it already shows better engineering:

- explicit arguments,
- validation,
- dependency checks,
- safe quoting,
- dry-run,
- target summary,
- rollout verification.

Later parts will improve this further.

---

## 28. Scripting and Idempotency

Idempotency means repeated execution leads to the same intended state without harmful side effects.

In automation, idempotency reduces operational fear.

Non-idempotent:

```bash
mkdir build
```

Fails if `build` already exists.

More idempotent:

```bash
mkdir -p build
```

But idempotency is not always that simple.

Publishing the same version twice may be unsafe:

```bash
docker push registry/service:1.0.0
```

Should a second run:

- skip because it already exists?
- fail because immutable release versions must not be overwritten?
- overwrite because this is a snapshot channel?

Idempotency is a contract, not a magic property.

You must define intended repeat behavior.

---

## 29. Scripting and Observability

A script without useful output is hard to operate.

But a script with noisy output is also hard to operate.

Good automation output separates audiences.

### Human Logs

Should go to `stderr` in many CLI designs, especially if `stdout` may be consumed by another program.

Examples:

```text
Checking required commands...
Building artifact...
Publishing image registry/service:1.2.3...
Waiting for rollout...
Deployment complete.
```

### Machine Output

Should be stable and parseable.

Example:

```json
{"artifact":"target/service.jar","version":"1.2.3","status":"success"}
```

### Exit Code

Should be meaningful.

At minimum:

```text
0 = success
non-zero = failure
```

For internal tools, more detailed exit codes may help.

Do not rely only on printed error messages.

Automation composes through exit status.

---

## 30. Scripting and Secrets

Secrets are one of the easiest things to mishandle in scripts.

Bad patterns:

```bash
echo "TOKEN=$TOKEN"
set -x
curl -H "Authorization: Bearer $TOKEN" ...
my_tool --password "$PASSWORD"
```

Risks:

- `set -x` may print expanded commands,
- CLI arguments may be visible to process inspection tools,
- logs may persist longer than expected,
- CI logs may be accessible by many users,
- diagnostic bundles may include environment dumps.

Safer principles:

```text
Validate presence without printing value.
Prefer passing secrets through stdin or dedicated secret mechanisms when supported.
Disable command tracing around secret usage.
Redact logs.
Avoid storing secrets in temp files.
Avoid putting secrets in generated artifacts.
```

For example:

```bash
[ -n "${API_TOKEN:-}" ] || die "API_TOKEN is required"
echo "API_TOKEN is set" >&2
```

Not:

```bash
echo "API_TOKEN=$API_TOKEN"
```

---

## 31. Scripting and Portability

Portability has levels.

### 31.1 Source Portability

Can the same script source run across environments?

Example challenge:

```bash
#!/usr/bin/env bash
```

requires Bash to exist in `PATH`.

```bash
#!/bin/sh
```

may run under `dash`, `bash`, `ash`, or another shell.

### 31.2 Command Portability

Even if shell syntax is portable, commands may not be.

Examples:

```text
GNU sed vs BSD sed
GNU find vs BSD find
GNU date vs BSD date
realpath availability
readlink behavior
xargs options
```

### 31.3 OS Portability

Linux, macOS, and Windows differ in:

- path format,
- file permissions,
- line endings,
- filesystem case sensitivity,
- default shell availability,
- installed command set,
- process model differences,
- terminal behavior.

### 31.4 Runtime Portability

PowerShell Core can run cross-platform, but only if installed.

Bash can run on Windows via Git Bash, WSL, MSYS2, or Cygwin, but those are not identical environments.

A mature script declares what it supports.

Do not claim portability accidentally.

---

## 32. Scripting and Reviewability

Scripts are often under-reviewed because they look simple.

This is backward.

Review should be stricter when blast radius is high.

Review checklist:

```text
Are all variables quoted unless intentionally split?
Are required inputs validated?
Are destructive operations guarded?
Is target environment explicit?
Does the script fail clearly?
Does it leak secrets?
Does it assume current directory?
Does it assume interactive input?
Does it work in CI?
Does it handle filenames with spaces?
Does it parse stable machine output instead of human output?
Is there a dry-run for dangerous operations?
Is cleanup reliable?
```

For Bash specifically, linting tools like ShellCheck help catch many common issues, but linting is not a substitute for design review.

---

## 33. Scripting and Testing

Not every script needs extensive tests.

But every important script needs some confidence strategy.

Testing options:

```text
Static analysis:
  shellcheck, shfmt, PSScriptAnalyzer

Unit-like tests:
  test functions in isolation

Golden tests:
  compare expected output

Integration tests:
  run script in temporary directory

Smoke tests:
  verify command starts and validates inputs

Dry-run tests:
  validate generated plan without mutation

CI tests:
  run script in clean environment
```

Test depth should match risk.

A local helper script may need only manual testing and linting.

A release script deserves automated tests around parsing, validation, and dry-run behavior.

A production mutation script deserves even more.

---

## 34. Scripting as Executable Documentation

A good script reduces tribal knowledge.

Instead of a wiki page saying:

```text
To release, first run Maven tests, then build the Docker image,
then tag it with the release version, then push it,
then update the deployment, then wait for rollout.
```

You encode the sequence:

```bash
make release VERSION=1.2.3
```

The script becomes executable documentation.

But this only works if the script is readable.

Unreadable automation is not documentation. It is encoded tribal knowledge.

---

## 35. Common Anti-Patterns

### 35.1 The God Script

One script does everything:

```text
build
test
package
publish
deploy
rollback
clean
diagnostics
```

Usually with many flags and hidden branches.

Better:

- split commands by lifecycle,
- share common library functions,
- expose simple Make targets,
- avoid one script becoming an application framework.

### 35.2 The CI YAML Swamp

CI config contains huge inline shell blocks.

Bad:

```yaml
run: |
  export A=...
  export B=...
  if [ ... ]; then
    ...
  fi
  for x in ...; do
    ...
  done
```

Better:

```yaml
run: make verify
```

and put logic in versioned scripts.

### 35.3 The Hidden Environment Script

Script only works if the developer has manually exported variables or installed tools.

Better:

- validate environment,
- print missing dependencies,
- document setup,
- provide bootstrap target.

### 35.4 The Unsafe Cleanup Script

```bash
rm -rf $DIR/*
```

Better:

- validate `DIR`,
- quote variables,
- use `--`,
- restrict allowed paths,
- consider temp directories,
- print target before deletion,
- support dry-run.

### 35.5 The Output Parsing Trap

Parsing human-oriented output:

```bash
some-cli list | grep thing | awk '{print $2}'
```

Better:

```bash
some-cli list --json | jq -r '.items[].id'
```

If the tool supports structured output, use it.

---

## 36. What You Should Be Able to Do After This Series

By the end of this series, you should be able to:

1. Design Bash scripts with safe parsing, quoting, error handling, and cleanup.
2. Decide when POSIX shell portability matters.
3. Use Bash for process orchestration without abusing it for complex application logic.
4. Use PowerShell's object pipeline effectively.
5. Build cross-platform automation with clear boundaries.
6. Design Makefiles as workflow facades and dependency graphs.
7. Keep CI YAML thin and move behavior into testable scripts.
8. Write scripts that are safe under failure, interruption, and repeated execution.
9. Protect secrets in automation.
10. Refactor fragile legacy scripts.
11. Create a production-grade automation toolkit for a Java service.

The point is not to become a “shell wizard.”

The point is to become an engineer who can safely turn operational intent into reliable automation.

---

## 37. Learning Strategy for This Series

Each part will follow this structure where appropriate:

```text
1. Mental model
2. Core semantics
3. Practical patterns
4. Failure modes
5. Production rules
6. Java/project integration
7. Exercises
8. Review checklist
```

Do not rush syntax.

For scripting, syntax without semantics creates false confidence.

The most important skills are:

```text
quoting
exit status reasoning
environment reasoning
file safety
process orchestration
structured output handling
target validation
idempotency
failure design
interface design
```

Syntax will become useful once those concepts are stable.

---

## 38. Mental Model Summary

The core model for this series:

```text
Scripting is not small code.
Scripting is operational control code.

Shell is not just syntax.
Shell is process orchestration plus command language expansion.

Bash is not portable POSIX by default.
Bash is a powerful practical shell with its own features and traps.

PowerShell is not Bash for Windows.
PowerShell is object-oriented automation with a pipeline model.

Makefile is not a random command menu.
Make is a dependency graph executor and workflow facade.

Good automation is not clever.
Good automation is explicit, boring, safe, repeatable, and debuggable.
```

---

## 39. Part 000 Checklist

You are ready to continue if you can explain:

- why scripting is control plane engineering,
- why blast radius matters more than line count,
- when to choose POSIX shell vs Bash vs PowerShell vs Make,
- why quoting and argument boundaries are central in shell scripting,
- why PowerShell pipelines differ from Bash pipelines,
- why Makefile is graph-oriented,
- what makes a script safe or dangerous,
- why CI/local parity matters,
- what idempotency means for scripts,
- why dry-run and target validation matter for mutating scripts.

---

## 40. References

Primary references for this series:

- GNU Bash Reference Manual — https://www.gnu.org/software/bash/manual/bash.html
- POSIX.1-2024 Shell Command Language — https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html
- Microsoft PowerShell Documentation — https://learn.microsoft.com/en-us/powershell/
- PowerShell about_Pipelines — https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_pipelines
- PowerShell about_Objects — https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_objects
- GNU Make Manual — https://www.gnu.org/software/make/manual/html_node/index.html

---

# End of Part 000

Part berikutnya:

```text
learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-001.md
```

Judul:

```text
Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment
```

Seri belum selesai. Ini adalah Part 000 dari 029.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<span></span>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-001.md">Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment ➡️</a>
</div>
