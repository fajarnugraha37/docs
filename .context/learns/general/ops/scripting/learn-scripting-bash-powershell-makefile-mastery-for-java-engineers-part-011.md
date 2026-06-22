# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-011.md

# Part 011 — Security Model for Shell Scripts

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: memahami threat model shell scripts: command injection, argument injection, PATH hijacking, secret leakage, unsafe temp files, symlink attacks, `eval`, `source`, supply-chain risk, CI/CD hardening, dan least privilege.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya:

- Part 001: process, stream, exit code, environment.
- Part 002: parsing, expansion, quoting.
- Part 003: POSIX shell baseline.
- Part 004: Bash fundamentals.
- Part 005: error handling.
- Part 006: data handling.
- Part 007: filesystem automation.
- Part 008: process control.
- Part 009: CLI design.
- Part 010: testing, linting, formatting, reviewability.

Part 011 adalah penutup blok Bash sebelum masuk PowerShell.

Shell script sering dianggap “internal”, sehingga security-nya disepelekan. Ini berbahaya karena script sering punya akses besar:

- token CI/CD;
- cloud credentials;
- production deploy permission;
- Docker socket;
- Kubernetes context;
- artifact registry;
- file system workspace;
- SSH keys;
- release signing key;
- database migration credentials.

Shell script adalah glue layer yang sering menghubungkan trust boundary berbeda.

Sebuah bug kecil seperti:

```bash
eval "$cmd"
```

atau:

```bash
curl "$url" | bash
```

atau:

```bash
rm -rf "$TARGET_DIR"
```

dengan validation buruk bisa menjadi supply-chain issue, credential leak, atau destructive incident.

Tujuan part ini:

> Membuat kamu mampu mendesain shell automation dengan threat model yang realistis.

---

## 1. Security Mindset untuk Shell Script

Security di shell bukan hanya “quote variable”.

Quoting penting, tetapi threat surface lebih luas:

- command injection;
- argument injection;
- option injection;
- PATH hijacking;
- untrusted environment variables;
- unsafe config sourcing;
- unsafe temp files;
- symlink race;
- secret leakage;
- debug trace leakage;
- dependency/tool hijacking;
- remote script execution;
- CI pull request trust boundary;
- artifact substitution;
- over-privileged credentials;
- destructive command without guard;
- shell history/process list leaks;
- log leaks;
- glob expansion surprises.

Core principle:

> Treat shell scripts as privileged automation programs, not disposable command snippets.

---

## 2. Trust Boundaries

A trust boundary exists whenever data moves from less-trusted to more-trusted context.

Examples:

| Data Source | Risk |
|---|---|
| CLI args | user-controlled |
| Env vars | CI/user-controlled |
| Config files | repo-controlled or attacker-controlled in PR |
| Git branch names | attacker-controlled in PR/fork |
| File names | can contain weird chars/options |
| API response | remote-controlled |
| Artifact metadata | supply-chain controlled |
| Pull request code | untrusted until reviewed |
| Cache contents | stale/tampered |
| PATH commands | may resolve to wrong executable |
| `.env` file | code if sourced |
| Downloaded script | remote code execution |

Security-aware script asks:

- who controls this value?
- can it contain spaces, quotes, newlines, `-`, `..`, glob chars?
- can it become command syntax?
- can it become option?
- can it select path outside allowed scope?
- can it leak secret?
- can it influence credentials/deployment target?
- can it execute code?

---

## 3. Command Injection

Command injection occurs when data becomes shell syntax.

Bad:

```bash
user_input="$1"
eval "echo $user_input"
```

If input:

```text
hello; rm -rf target
```

shell executes two commands.

Bad:

```bash
cmd="kubectl get pod $pod_name"
eval "$cmd"
```

If `pod_name` is malicious, command injection.

Better:

```bash
kubectl get pod "$pod_name"
```

Or array:

```bash
cmd=(kubectl get pod "$pod_name")
"${cmd[@]}"
```

Key principle:

> Build commands as argument arrays, not strings.

---

## 4. Quotes Inside Variables Do Not Protect You

Bad:

```bash
args='--name "Alice Smith"'
tool $args
```

Shell does not treat quotes inside variable as syntax. It splits after expansion.

Worse:

```bash
args='--name Alice; rm -rf target'
eval "tool $args"
```

Now injected syntax executes.

Correct:

```bash
args=(--name "Alice Smith")
tool "${args[@]}"
```

Analogy to Java:

Bad shell string command is like:

```java
Runtime.getRuntime().exec("tool --name " + userInput);
```

Better:

```java
new ProcessBuilder("tool", "--name", userInput);
```

Bash arrays are the `List<String>` equivalent.

---

## 5. Argument Injection

Even if command injection is prevented, attacker may inject extra arguments.

Bad:

```bash
grep "$pattern" "$file"
```

This looks quoted. But if `pattern` starts with `-`:

```text
--include=*
```

`grep` may treat it as option.

Use `--`:

```bash
grep -- "$pattern" "$file"
```

For file path:

```bash
rm -- "$file"
```

For many commands:

```bash
cp -- "$src" "$dst"
mv -- "$src" "$dst"
tar -- "$archive"
```

Caveat: not all commands support `--`. Know your tool.

Option injection example:

```bash
file="-rf"
rm "$file"
```

Could be interpreted as option. With:

```bash
rm -- "$file"
```

safe as operand.

Principle:

> Quoting preserves argument boundary. `--` protects option boundary.

---

## 6. Semantic Injection

Sometimes value is a single argument and not an option, but still dangerous semantically.

Example:

```bash
env="$1"
deploy --env "$env"
```

If `env` is:

```text
prod
```

that may be allowed only with approval.

Validate:

```bash
case "$env" in
  dev|staging|prod) ;;
  *) die "invalid env: $env" ;;
esac
```

Another example:

```bash
image_tag="$1"
docker push "$image_tag"
```

If attacker controls `image_tag`, they can push to unexpected registry.

Validate registry/namespace:

```bash
case "$image_tag" in
  registry.internal.example.com/team/*:*) ;;
  *) die "image tag must be internal registry: $image_tag" ;;
esac
```

Security is not just shell syntax. It is domain validation.

---

## 7. Path Traversal

Bad:

```bash
target="$project_root/$user_path"
cat "$target"
```

If `user_path`:

```text
../../secrets.txt
```

Script reads outside project.

Mitigations:

1. Avoid arbitrary path input.
2. Use enum/whitelist.
3. Canonicalize and check root.
4. Refuse symlinks for sensitive operations.
5. Use dedicated directories.

Better:

```bash
case "$name" in
  config) target="$project_root/config/app.yml" ;;
  logs) target="$project_root/logs/app.log" ;;
  *) die "invalid target name: $name" ;;
esac
```

Whitelist beats path sanitization.

---

## 8. Symlink Attacks and Unsafe Temp Files

Unsafe:

```bash
tmp="/tmp/my-script-output"
echo data > "$tmp"
```

Another user/process could pre-create symlink:

```bash
/tmp/my-script-output -> /important/file
```

Your script writes to important file.

Use:

```bash
tmp="$(mktemp)"
```

For directories:

```bash
tmp_dir="$(mktemp -d)"
```

For target atomic write, create temp in target dir:

```bash
tmp="$(mktemp "$target_dir/.tmp.XXXXXX")"
```

Also consider:

- restrictive umask for secrets;
- cleanup trap;
- refusing symlink target if dangerous;
- file permissions.

Do not use predictable temp names with `$$` alone:

```bash
tmp="/tmp/app.$$"
```

PID is predictable and not sufficient.

---

## 9. PATH Hijacking

When script runs:

```bash
mvn test
```

Shell resolves `mvn` via `PATH`.

An attacker or broken environment can put malicious `mvn` earlier in PATH.

This matters in:

- CI jobs running untrusted PR code;
- scripts executed from writable directories;
- install scripts;
- privileged scripts;
- cron jobs;
- sudo contexts.

Mitigations:

### 9.1 Validate command path

```bash
mvn_path="$(command -v mvn)" || die "mvn not found"
printf 'Using mvn: %s\n' "$mvn_path" >&2
```

### 9.2 Set safe PATH

For privileged scripts:

```bash
export PATH="/usr/local/bin:/usr/bin:/bin"
```

But this may break developer tooling like SDKMAN/Homebrew. Use only in controlled environment.

### 9.3 Avoid current directory in PATH

Ensure `.` is not in PATH for automation.

```bash
case ":$PATH:" in
  *":.:"*) die "PATH must not contain current directory" ;;
esac
```

### 9.4 Use absolute path for critical tools

```bash
/usr/bin/env bash
/usr/bin/curl
```

But paths vary by OS. In controlled CI image, absolute paths can be okay.

### 9.5 Do not run untrusted repo tools with secrets

If PR can modify `./mvnw`, do not run it with production secrets before trust boundary is resolved.

---

## 10. Wrapper Scripts and Trust

Java projects often use:

```bash
./mvnw
./gradlew
```

These are repo-controlled scripts. They are convenient, but if PR modifies them, they can exfiltrate secrets.

In CI for pull requests from forks:

- do not expose secrets;
- do not run deploy jobs;
- be cautious running repo-controlled scripts;
- use restricted token permissions;
- separate trusted post-merge pipelines.

For internal branches, risk lower but still exists.

Threat model:

```text
Untrusted PR modifies gradlew to print DEPLOY_TOKEN.
CI runs ./gradlew with DEPLOY_TOKEN available.
Secret leaked.
```

Mitigation:

- do not provide deploy secrets to PR workflows;
- use least privilege tokens;
- require approval for workflows from forks;
- separate build/test from deploy;
- pin wrapper validation if needed.

---

## 11. Environment Variable Risks

Environment variables can be:

- missing;
- malicious;
- inherited by child processes;
- dumped in logs;
- exposed by debug tooling;
- read by subprocesses;
- used by tools in surprising ways.

Examples:

```bash
BASH_ENV
ENV
IFS
CDPATH
SHELLOPTS
GIT_SSH_COMMAND
AWS_PROFILE
KUBECONFIG
MAVEN_OPTS
JAVA_TOOL_OPTIONS
LD_PRELOAD
```

Some env vars can alter behavior drastically.

For sensitive scripts, sanitize environment.

Example controlled execution:

```bash
env -i \
  PATH="/usr/bin:/bin" \
  HOME="$HOME" \
  APP_ENV="$APP_ENV" \
  command args...
```

But this can break tools needing environment. Use carefully.

At minimum:

- validate required env;
- do not log all env;
- do not pass secrets to unnecessary child processes;
- unset sensitive env before running untrusted commands.

Example:

```bash
(
  unset DEPLOY_TOKEN
  ./run-untrusted-tests.sh
)
```

---

## 12. Secret Leakage: CLI Args, Logs, Process List

Bad:

```bash
deploy.sh --token "$DEPLOY_TOKEN"
```

CLI args can show in process list and shell history.

Better:

```bash
DEPLOY_TOKEN=... deploy.sh
```

But env can also leak to child process or debugging.

Better in CI:

- use secret injection features;
- mask secrets in logs;
- avoid printing commands with secrets;
- use files with restricted permissions if tool supports;
- use short-lived tokens;
- use OIDC/cloud identity where possible.

Bad log:

```bash
set -x
curl -H "Authorization: Bearer $DEPLOY_TOKEN" ...
```

`set -x` prints expanded command.

Mitigation:

```bash
set +x
curl -H "Authorization: Bearer $DEPLOY_TOKEN" ...
```

Better: avoid `set -x` in secret-bearing scripts.

---

## 13. `set -x` Is Dangerous

Debug trace expands variables.

Example:

```bash
set -x
TOKEN=secret
curl -H "Authorization: Bearer $TOKEN" ...
```

Log contains secret.

Use explicit debug:

```bash
debug "calling deploy endpoint env=$env version=$version"
```

If trace needed, make it opt-in and secret-aware:

```bash
enable_trace() {
  if [[ "${TRACE:-false}" == "true" ]]; then
    export PS4='+ ${BASH_SOURCE}:${LINENO}: '
    set -x
  fi
}
```

Disable around secrets:

```bash
{ set +x; } 2>/dev/null
curl ...
if [[ "${TRACE:-false}" == "true" ]]; then
  set -x
fi
```

But this is brittle. Prefer no trace where secrets exist.

---

## 14. Secret Redaction

Redaction helper:

```bash
redact_tail() {
  local value="$1"

  if ((${#value} <= 4)); then
    printf '****'
  else
    printf '****%s' "${value: -4}"
  fi
}
```

Use:

```bash
debug "using token=$(redact_tail "$DEPLOY_TOKEN")"
```

But even redacted secret metadata can be sensitive.

Do not log:

- full token;
- private key;
- auth header;
- signed URL;
- session cookie;
- kubeconfig;
- cloud credential JSON;
- decrypted config.

---

## 15. `.env` and `source` Risk

Common:

```bash
source .env
```

But `source` executes shell code.

If `.env` contains:

```bash
rm -rf "$HOME"
```

it runs.

Even accidental:

```bash
PASSWORD=hello world
```

tries to run `world`.

Safer options:

1. Treat `.env` as trusted developer code.
2. Use a restricted parser.
3. Use secret manager.
4. Use CI env injection.
5. Validate after loading.

If source is acceptable:

```bash
set -a
# shellcheck disable=SC1091
source .env
set +a
```

But document `.env` is shell syntax.

For untrusted `.env`, do not source. Parse simple `KEY=VALUE` format carefully or use a proper tool.

---

## 16. `BASH_ENV` Risk

Non-interactive Bash can read file named by `BASH_ENV`.

If environment contains:

```bash
BASH_ENV=/tmp/malicious
```

then Bash scripts may execute it.

For sensitive scripts, consider unsetting:

```bash
unset BASH_ENV
```

At top:

```bash
unset BASH_ENV ENV
```

Caveat: if script already started via Bash, `BASH_ENV` may have been processed before first line. But unsetting prevents child Bash from using it.

---

## 17. `CDPATH` Risk

`cd` output can be surprising if `CDPATH` set.

In scripts resolving directory:

```bash
script_dir="$(cd "$(dirname "$0")" && pwd)"
```

If `CDPATH` causes `cd` to print path, command substitution can contain extra output.

Mitigate:

```bash
script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
```

Set `CDPATH=` for directory resolution.

---

## 18. IFS Risk

`IFS` controls word splitting.

Attackers changing IFS historically caused issues. Modern Bash invocation reduces some risk, but scripts should not rely on ambient IFS.

Use local explicit IFS for reads:

```bash
while IFS= read -r line; do
  ...
done
```

For splitting:

```bash
IFS=, read -r a b c <<< "$line"
```

Do not globally set IFS unless necessary.

---

## 19. Globbing Risk

Unquoted variable can expand globs:

```bash
pattern="*"
rm $pattern
```

Dangerous.

Quote variables:

```bash
rm -- "$pattern"
```

If globbing intended, make it explicit:

```bash
shopt -s nullglob
files=(./logs/*.log)
shopt -u nullglob
```

Never let untrusted data become glob pattern unless intended and constrained.

---

## 20. `eval` Risk

Default rule:

> Do not use `eval`.

Unsafe:

```bash
eval "$user_command"
```

Almost always avoidable with arrays, case dispatch, functions.

Instead of dynamic function call from user input:

Bad:

```bash
eval "cmd_$command"
```

Good:

```bash
case "$command" in
  build) cmd_build ;;
  test) cmd_test ;;
  deploy) cmd_deploy ;;
  *) die "unknown command" ;;
esac
```

If you believe `eval` is necessary, write a threat model in comment and tests. Most internal scripts do not need it.

---

## 21. `curl | bash` Supply-Chain Risk

Bad pattern:

```bash
curl -fsSL https://example.com/install.sh | bash
```

Risks:

- executes remote code immediately;
- no review;
- network MITM if TLS/trust compromised;
- server compromise;
- script changes over time;
- no checksum/signature;
- partial download can behave unexpectedly;
- hard to audit in CI.

Safer:

1. Download.
2. Verify checksum/signature.
3. Review or pin version.
4. Execute with least privilege.

Example:

```bash
curl -fsSLo tool.tar.gz "$url"
echo "$expected_sha256  tool.tar.gz" | sha256sum -c -
tar -xzf tool.tar.gz
```

If install script unavoidable, pin version and checksum.

For CI, prefer package manager, pinned container image, or vendored tool.

---

## 22. Dependency Pinning

Automation depends on tools:

- jq;
- curl;
- bash;
- docker;
- kubectl;
- helm;
- yq;
- shellcheck;
- shfmt.

Risks:

- version changes behavior;
- malicious binary in PATH;
- unpinned download;
- different CI/local version.

Mitigate:

- use dev container;
- pin CI image;
- check versions;
- use tool lockfiles;
- download with checksum;
- avoid latest URLs.

Example version check:

```bash
jq --version >&2
```

For strict:

```bash
required_jq_major=1
actual="$(jq --version)" # jq-1.6
case "$actual" in
  jq-1.6|jq-1.7*) ;;
  *) die "unsupported jq version: $actual" ;;
esac
```

Do not over-parse unless necessary.

---

## 23. Artifact Substitution

If script deploys artifact by path:

```bash
deploy --artifact target/app.jar
```

Threats:

- artifact stale;
- artifact modified after build;
- artifact from wrong branch;
- malicious replacement;
- path symlink;
- checksum mismatch.

Mitigations:

- build and deploy in controlled workspace;
- compute checksum;
- sign artifact;
- use immutable artifact registry;
- deploy by version/digest, not local mutable file;
- verify metadata.

Example:

```bash
sha256sum target/app.jar > target/app.jar.sha256
```

Deploy:

```bash
artifact_digest="$(sha256sum target/app.jar | awk '{print $1}')"
printf 'Deploying version=%s digest=%s\n' "$version" "$artifact_digest" >&2
```

For production, prefer registry digest:

```text
image@sha256:...
```

over mutable tag:

```text
image:latest
```

---

## 24. Git Data Is Attacker-Controlled in PRs

Branch names can contain characters that break assumptions.

Bad:

```bash
docker_tag="$(git branch --show-current)"
docker build -t "app:$docker_tag" .
```

Branch name may contain `/`, uppercase, weird chars, long string.

Validate/sanitize:

```bash
branch="$(git branch --show-current)"
safe_branch="$(printf '%s' "$branch" | tr '/[:upper:]' '-[:lower:]')"

[[ "$safe_branch" =~ ^[a-z0-9._-]+$ ]] || die "unsafe branch-derived tag"
```

But exact Docker tag rules are nuanced. Be conservative.

Commit messages, author names, tags, filenames in repo can be attacker-controlled. Do not put them into shell syntax or unescaped JSON.

---

## 25. CI Pull Request Security

Key rule:

> Do not expose secrets to untrusted code.

Untrusted code includes:

- fork PR;
- branch from external contributor;
- generated scripts in repo;
- modified build tool wrapper;
- test code that can execute arbitrary commands.

Separate pipelines:

1. PR validation:
   - no production secrets;
   - read-only token;
   - limited permissions;
   - no deploy.

2. Trusted merge/main:
   - release secrets available;
   - deploy possible;
   - stricter approvals.

3. Manual approval deploy:
   - environment protected;
   - least privilege.

Script design cannot compensate for CI exposing secrets to untrusted code.

---

## 26. Least Privilege

Do not run scripts with broad credentials if narrow ones suffice.

Examples:

- deploy token can only deploy one service/environment;
- artifact token read-only for verify;
- release token cannot delete artifacts;
- cloud role scoped to required resources;
- Kubernetes service account scoped to namespace;
- database migration user lacks destructive admin unless needed.

In scripts:

- require env-specific token;
- refuse prod if token not intended;
- avoid reusing personal admin tokens;
- do not run as root unless necessary.

If running as root:

```bash
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  die "do not run this script as root"
fi
```

Or require root only for install:

```bash
if [[ "$EUID" -ne 0 ]]; then
  die "this install step requires root"
fi
```

Be explicit.

---

## 27. Sudo in Scripts

Avoid hidden sudo:

```bash
sudo rm -rf /some/path
```

Problems:

- prompts hang CI;
- privilege escalation hidden;
- hard to audit;
- environment changes under sudo;
- PATH changes;
- root-owned files created in workspace.

If sudo needed:

- document;
- check non-interactive mode;
- isolate privileged action;
- fail early if not allowed;
- avoid passing untrusted data.

Example:

```bash
if [[ "$requires_sudo" == "true" ]]; then
  sudo -n true || die "sudo required but not available non-interactively"
fi
```

Then run explicit sudo command.

---

## 28. Docker Socket Risk

Access to Docker socket is effectively root-equivalent on many hosts.

Script:

```bash
docker run -v /:/host ...
```

can read/write host.

CI with Docker socket should be treated as privileged.

Mitigations:

- do not expose Docker socket to untrusted PRs;
- use rootless/buildkit where possible;
- restrict volumes;
- use isolated runners;
- prefer build service with scoped permissions.

Shell script invoking Docker should not accept arbitrary `docker run` options from untrusted input.

Bad:

```bash
docker run $USER_OPTS image
```

Better: whitelist specific options.

---

## 29. Kubernetes Context Risk

Scripts using `kubectl` can affect production if context wrong.

Bad:

```bash
kubectl apply -f deploy.yml
```

without context validation.

Better:

```bash
current_context="$(kubectl config current-context)"
case "$env:$current_context" in
  staging:company-staging) ;;
  prod:company-prod) ;;
  *) die "kubectl context $current_context does not match env $env" ;;
esac
```

Also specify:

```bash
kubectl --context "$expected_context" --namespace "$namespace" apply -f deploy.yml
```

Avoid relying on ambient context.

For production, require explicit env and confirmation/CI environment protection.

---

## 30. Cloud CLI Profile Risk

AWS/GCP/Azure CLI use ambient profiles/accounts.

Validate:

```bash
aws sts get-caller-identity
```

Check account:

```bash
account_id="$(aws sts get-caller-identity --query Account --output text)"
[[ "$account_id" == "$expected_account" ]] || die "wrong AWS account: $account_id"
```

For scripts:

- specify profile/role explicitly;
- validate account/project/subscription;
- avoid default ambient profile for production;
- log account id but not secrets.

---

## 31. Unsafe File Permissions

Secret files:

```bash
echo "$TOKEN" > token.txt
```

May create world-readable depending umask.

Use:

```bash
(
  umask 077
  printf '%s' "$TOKEN" > "$token_file"
)
```

Check:

```bash
chmod 0600 "$token_file"
```

Do not store secrets in repo/workspace unless necessary. Clean up with trap.

But cleanup is not guaranteed on crash. Prefer ephemeral CI secret mechanisms.

---

## 32. Shell History Leaks

Local usage:

```bash
export DEPLOY_TOKEN=secret
deploy.sh
```

May end up in shell history if typed directly.

Better:

- use password manager/secret manager;
- use environment injected by tool;
- use `read -s` for interactive secret if needed;
- avoid documenting commands with literal secrets.

If reading secret:

```bash
read -r -s -p "Token: " DEPLOY_TOKEN
printf '\n' >&2
export DEPLOY_TOKEN
```

Do not use for CI.

---

## 33. Process List Leaks

CLI args visible:

```bash
ps -ef
```

May show:

```text
curl -H Authorization: Bearer secret
```

Even if script does not log.

If tool supports reading secret from file/stdin, prefer it.

For curl, header still becomes arg. If process list exposure matters, use config file with restricted permissions:

```bash
curl_config="$(mktemp)"
chmod 0600 "$curl_config"
cat > "$curl_config" <<EOF
header = "Authorization: Bearer $DEPLOY_TOKEN"
EOF

curl --config "$curl_config" "$url"
```

Cleanup after. But secret exists on disk temporarily.

Trade-offs depend threat model.

In CI single-tenant runner, process list may be less exposed. In shared host, more serious.

---

## 34. Log Masking Is Not a Security Boundary

CI may mask known secrets, but:

- transformed secrets may not be masked;
- base64/URL-encoded form may leak;
- partial secrets may leak;
- JSON escaped secrets may leak;
- secret in file artifact may leak;
- third-party tool logs may bypass masking.

Do not rely solely on masking.

Avoid printing secrets in the first place.

---

## 35. Input Validation Patterns

### 35.1 Enum

```bash
case "$env" in
  dev|staging|prod) ;;
  *) die "invalid env: $env" ;;
esac
```

### 35.2 Conservative identifier

```bash
[[ "$name" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || die "invalid name: $name"
```

### 35.3 Version

```bash
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version: $version"
```

### 35.4 URL allowlist

```bash
case "$DEPLOY_URL" in
  https://deploy.internal.example.com|https://deploy-staging.internal.example.com)
    ;;
  *)
    die "DEPLOY_URL is not an approved endpoint"
    ;;
esac
```

### 35.5 Path target whitelist

```bash
case "$target" in
  "$project_root"/build|"$project_root"/target) ;;
  *) die "refusing target: $target" ;;
esac
```

Prefer allowlist over blocklist.

---

## 36. Blocklists Are Weak

Bad:

```bash
if [[ "$input" == *";"* ]]; then
  die "bad input"
fi
```

Attackers can use:

- newline;
- `$()`;
- backticks;
- `&&`;
- `|`;
- glob;
- option injection;
- encoding;
- semantic misuse.

Better:

```bash
[[ "$input" =~ ^[a-zA-Z0-9._-]+$ ]] || die "invalid input"
```

Even better: avoid putting input into shell syntax at all.

---

## 37. Safe Command Construction Recap

Bad:

```bash
cmd="deploy --env $env --version $version"
eval "$cmd"
```

Good:

```bash
cmd=(deploy --env "$env" --version "$version")
"${cmd[@]}"
```

With optional:

```bash
cmd=(deploy --env "$env" --version "$version")

if [[ "$dry_run" == "true" ]]; then
  cmd+=(--dry-run)
fi

"${cmd[@]}"
```

This is the security-critical Bash pattern.

---

## 38. Remote Data to Local Command

Bad:

```bash
name="$(curl -fsS "$url/name")"
mkdir "$name"
```

At least validate:

```bash
name="$(curl -fsS "$url/name")"
[[ "$name" =~ ^[a-z][a-z0-9-]{0,62}$ ]] || die "invalid remote name"
mkdir -- "$name"
```

Do not trust API response just because it is internal. Internal services can be compromised or return unexpected data.

---

## 39. Destructive Command Guard

Before:

```bash
rm -rf -- "$target"
```

Require:

- non-empty;
- under expected root;
- not `/`;
- not symlink unless intended;
- whitelisted if possible;
- dry-run option;
- explicit confirmation for high-risk;
- test coverage.

Example:

```bash
safe_delete_build_dir() {
  local target="$1"

  case "$target" in
    "$project_root"/build|"$project_root"/target)
      ;;
    *)
      die "refusing to delete unapproved target: $target"
      ;;
  esac

  [[ ! -L "$target" ]] || die "refusing to delete symlink: $target"

  rm -rf -- "$target"
}
```

---

## 40. Case Study: Vulnerable Deploy Script

```bash
#!/bin/bash
env=$1
version=$2

source .env

cmd="curl -H 'Authorization: Bearer $TOKEN' $DEPLOY_URL/deploy?env=$env&version=$version"
eval "$cmd"

kubectl apply -f k8s/$env.yml
```

Problems:

1. No strict mode.
2. Positional ambiguous args.
3. No validation.
4. `.env` executed as code.
5. Secret in command string.
6. `eval`.
7. URL unquoted.
8. Query built unsafely.
9. No endpoint allowlist.
10. Ambient kubectl context.
11. Env controls path.
12. No prod guard.
13. No token check.
14. No timeout.
15. No least privilege.
16. Potential command injection via env/version/DEPLOY_URL/TOKEN.
17. Potential path traversal via `k8s/$env.yml`.

---

## 41. Hardened Direction

```bash
#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

usage_error() {
  printf 'Usage: deploy.sh --env <staging|prod> --version <x.y.z> [--yes]\n' >&2
  printf 'ERROR: %s\n' "$*" >&2
  exit 2
}

main() {
  local env=""
  local version=""
  local yes=false

  while (($# > 0)); do
    case "$1" in
      --env)
        (($# >= 2)) || usage_error "--env requires value"
        env="$2"
        shift 2
        ;;
      --version)
        (($# >= 2)) || usage_error "--version requires value"
        version="$2"
        shift 2
        ;;
      --yes)
        yes=true
        shift
        ;;
      *)
        usage_error "unknown argument: $1"
        ;;
    esac
  done

  case "$env" in
    staging|prod) ;;
    *) usage_error "invalid env: $env" ;;
  esac

  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage_error "invalid version: $version"

  : "${DEPLOY_URL:?DEPLOY_URL is required}"
  : "${DEPLOY_TOKEN:?DEPLOY_TOKEN is required}"

  case "$DEPLOY_URL" in
    https://deploy.internal.example.com|https://deploy-staging.internal.example.com)
      ;;
    *)
      die "DEPLOY_URL is not approved"
      ;;
  esac

  if [[ "$env" == "prod" && "$yes" != "true" ]]; then
    die "prod deploy requires --yes"
  fi

  local kube_context namespace manifest

  case "$env" in
    staging)
      kube_context="company-staging"
      namespace="myapp-staging"
      manifest="k8s/staging.yml"
      ;;
    prod)
      kube_context="company-prod"
      namespace="myapp-prod"
      manifest="k8s/prod.yml"
      ;;
  esac

  [[ -f "$manifest" ]] || die "manifest missing: $manifest"

  local payload
  payload="$(jq -n --arg env "$env" --arg version "$version" '{env:$env, version:$version}')"

  printf 'Requesting deployment env=%s version=%s\n' "$env" "$version" >&2

  curl \
    --fail \
    --show-error \
    --silent \
    --connect-timeout 5 \
    --max-time 60 \
    --header "Authorization: Bearer $DEPLOY_TOKEN" \
    --header 'Content-Type: application/json' \
    --data "$payload" \
    "${DEPLOY_URL%/}/deploy"

  current_context="$(kubectl config current-context)"
  [[ "$current_context" == "$kube_context" ]] || die "wrong kubectl context: $current_context expected $kube_context"

  kubectl --context "$kube_context" --namespace "$namespace" apply -f "$manifest"
}

main "$@"
```

Still requires CI/credential controls, but much safer.

---

## 42. Security Checklist for Shell Scripts

### Input

- Are all CLI args validated?
- Are env vars validated?
- Are branch names/tags treated as untrusted?
- Are API responses validated?
- Are paths whitelisted/canonicalized?

### Command execution

- Is `eval` avoided?
- Are arrays used for dynamic commands?
- Are variables quoted?
- Is `--` used to prevent option injection?
- Are commands resolved safely?

### Filesystem

- Are temp files created with `mktemp`?
- Are secret files created with mode 0600/umask 077?
- Are symlinks handled?
- Are destructive paths whitelisted?

### Secrets

- No secrets in CLI args?
- No `set -x` around secrets?
- No environment dumps?
- No token in logs?
- No secret in artifacts?

### CI/CD

- Are secrets unavailable to untrusted PRs?
- Are token permissions minimal?
- Are deploy jobs protected?
- Is repo-controlled wrapper trusted before secrets?
- Are tools pinned?

### External systems

- Is kubectl context explicit/validated?
- Is cloud account/project validated?
- Are artifact digests used?
- Are remote scripts avoided or verified?

---

## 43. Mini Lab

### Lab 1 — Command injection

Write vulnerable script:

```bash
input="$1"
eval "echo $input"
```

Run with:

```bash
'hello; echo injected'
```

Then rewrite without eval:

```bash
printf '%s\n' "$input"
```

---

### Lab 2 — Argument injection

Create file named:

```bash
touch -- '--help'
```

Try commands with and without `--`.

---

### Lab 3 — Fake PATH command

Create fake `mvn` earlier in PATH and see script use it.

Then add logging:

```bash
command -v mvn
```

Discuss mitigation.

---

### Lab 4 — `source .env` risk

Create `.env`:

```bash
echo 'echo "executed from env" >&2' > .env
```

Source it and observe code execution.

---

### Lab 5 — `set -x` secret leak

Run:

```bash
TOKEN=secret bash -c 'set -x; curl -H "Authorization: Bearer $TOKEN" http://example.invalid'
```

Observe trace. Then redesign debug logging.

---

## 44. Design Exercise: Threat Model a Deploy Script

For `deploy-release.sh`, write:

```text
Assets:
  DEPLOY_TOKEN
  artifact version
  production environment
  kube context
  CI runner

Trust boundaries:
  CLI args
  env vars
  git branch
  artifact metadata
  API response
  repo scripts
  CI PR context

Threats:
  command injection
  wrong environment
  secret leak
  artifact substitution
  PR exfiltration
  PATH hijack
  kubectl wrong context
  destructive cleanup

Mitigations:
  named flags
  validation
  arrays
  endpoint allowlist
  no set -x
  least privilege token
  protected CI environment
  digest deployment
  context validation
  dry-run/plan
```

Then map each mitigation to code or CI configuration.

---

## 45. Part 011 Summary

Shell security is about trust boundaries and side effects.

Key takeaways:

1. Shell scripts often run with powerful credentials.
2. Quoting is necessary but not sufficient.
3. Avoid `eval`; use arrays and explicit dispatch.
4. Prevent argument/option injection with `--` and validation.
5. Prefer allowlists over blocklists.
6. Treat paths as dangerous input.
7. Use `mktemp`; avoid predictable temp files.
8. Beware PATH hijacking and repo-controlled wrappers in CI.
9. Do not expose secrets to untrusted PR code.
10. Avoid secrets in CLI args, logs, traces, and artifacts.
11. `source .env` executes code.
12. `curl | bash` is remote code execution; pin and verify dependencies.
13. Validate kubectl/cloud context before mutation.
14. Use least privilege credentials.
15. Design CI trust boundaries; script hardening alone is not enough.
16. Threat model deploy/release/cleanup scripts explicitly.

This completes the Bash-focused foundation block. Part 012 starts the PowerShell block: **PowerShell Mental Model: Objects, Pipeline, Providers**.

---

## 46. Referensi Resmi dan Bacaan Lanjutan

- GNU Bash Reference Manual — expansions, quoting, shell parameters, command execution, traps.
- ShellCheck documentation — security-relevant shell warnings.
- OWASP Command Injection guidance — general command injection principles.
- POSIX Utility Syntax Guidelines — option/operand conventions.
- curl documentation — secure downloads, TLS, retry/timeout behavior.
- Kubernetes documentation — kubeconfig contexts and RBAC concepts.
- Cloud provider IAM/RBAC documentation — least privilege and workload identity.
- SLSA / supply-chain security materials — build and artifact integrity concepts.
- CI provider security documentation — pull request secrets, protected environments, token permissions.

---

## 47. Status Seri

Seri belum selesai.

Progress:

- [x] Part 000 — Orientation: Scripting as Engineering Control Plane
- [x] Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment
- [x] Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting
- [x] Part 003 — POSIX Shell Baseline: Portable Script Before Bash-Specific Script
- [x] Part 004 — Bash Fundamentals Without Toy Examples
- [x] Part 005 — Error Handling in Bash: Fail Fast, Fail Clear, Fail Safe
- [x] Part 006 — Data Handling in Bash: Text, Lines, Null Bytes, JSON, CSV
- [x] Part 007 — Filesystem Automation: Safe File Operations
- [x] Part 008 — Process Control: Background Jobs, Signals, Timeouts, Concurrency
- [x] Part 009 — CLI Design for Internal Tools
- [x] Part 010 — Bash Testing, Linting, Formatting, and Reviewability
- [x] Part 011 — Security Model for Shell Scripts
- [ ] Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers
- [ ] Part 013 — PowerShell Language Fundamentals for Java Engineers
- [ ] Part 014 — PowerShell Error Handling, Strictness, and Observability
- [ ] Part 015 — PowerShell Data Automation: JSON, XML, CSV, REST, Objects
- [ ] Part 016 — Cross-Platform PowerShell: Windows, Linux, macOS, Containers
- [ ] Part 017 — PowerShell Modules and Reusable Automation Architecture
- [ ] Part 018 — Makefile Mental Model: Dependency Graph, Targets, Recipes
- [ ] Part 019 — Practical Makefile Syntax and Execution Semantics
- [ ] Part 020 — Makefile for Java Projects: Maven, Gradle, Docker, CI Facade
- [ ] Part 021 — Makefile as Workflow Orchestrator, Not Build System Replacement
- [ ] Part 022 — Script Portability Matrix: Bash, POSIX sh, PowerShell, Make, Java
- [ ] Part 023 — Environment Management and Configuration Contracts
- [ ] Part 024 — CI/CD Scripting: From Laptop Command to Pipeline Contract
- [ ] Part 025 — Release and Deployment Automation
- [ ] Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools
- [ ] Part 027 — Advanced Bash and PowerShell Interop
- [ ] Part 028 — Refactoring Legacy Scripts
- [ ] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-010.md">⬅️ Part 010 — Bash Testing, Linting, Formatting, and Reviewability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-012.md">Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers ➡️</a>
</div>
