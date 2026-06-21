# learn-linux-kernel-mastery-for-java-engineers-part-029.md

# Part 029 — Containers III: Images, OverlayFS, Runtime, CRI, and Kubernetes Node Internals

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `029`  
> Topik: Container images, OCI image format, layers, overlayfs, copy-on-write, image pull, container runtime, containerd, CRI-O, runc, CRI, kubelet, sandbox/pause container, Kubernetes node internals, logs, disk pressure, image GC, dan implikasinya untuk Java service  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 027, kita membahas:

```text
Containers I: namespaces from first principles
```

Pada Part 028, kita membahas:

```text
Containers II: cgroups, CPU/memory limits, OOMKilled, JVM ergonomics
```

Part 029 melengkapi pemahaman container dari sisi:

```text
Image -> runtime -> rootfs -> process -> Kubernetes node
```

Kita akan menjawab pertanyaan seperti:

- Apa sebenarnya container image?
- Apa itu layer?
- Kenapa image size memengaruhi startup?
- Apa itu overlayfs copy-up?
- Kenapa file yang dihapus di image layer tidak selalu mengurangi final image secara efektif?
- Kenapa menulis file di container writable layer buruk untuk workload berat?
- Apa bedanya Docker, containerd, CRI-O, runc?
- Apa itu CRI?
- Apa peran kubelet?
- Apa itu pause container / pod sandbox?
- Di mana container logs berada?
- Kenapa pod bisa `ImagePullBackOff`?
- Kenapa node `DiskPressure`?
- Kenapa image GC bisa memengaruhi scheduling/startup?
- Bagaimana debug container runtime issue di node Kubernetes?

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan container image sebagai immutable filesystem template plus metadata.
2. Memahami OCI image:
   - manifest
   - config
   - layers
   - digest
   - tags
   - media types
3. Membedakan:
   - image
   - container
   - layer
   - snapshot
   - rootfs
   - writable layer
4. Memahami layer caching dan image pull behavior.
5. Memahami overlayfs:
   - lowerdir
   - upperdir
   - workdir
   - merged
   - copy-up
   - whiteout
6. Memahami kenapa Dockerfile instruction memengaruhi layer.
7. Memahami best practices image untuk Java:
   - multi-stage build
   - slim/distroless
   - dependency layer caching
   - non-root user
   - SBOM/scanning
   - reproducible builds
   - JRE vs JDK vs jlink
8. Memahami container runtime stack:
   - kubelet
   - CRI
   - containerd/CRI-O
   - OCI runtime
   - runc/crun
9. Memahami Kubernetes pod sandbox/pause container.
10. Memahami container logs:
    - stdout/stderr
    - CRI log format
    - log rotation
    - disk pressure
11. Memahami node storage:
    - image filesystem
    - container writable layers
    - logs
    - emptyDir
    - ephemeral storage
12. Mendiagnosis:
    - ImagePullBackOff
    - CrashLoopBackOff related to runtime/startup
    - CreateContainerError
    - containerd/runc failure
    - disk pressure
    - slow image pull
    - overlayfs copy-up latency
    - deleted file still taking space
    - large Java image startup/pull issue
    - read-only rootfs and writable path problem

---

## 2. Mental Model: Image vs Container

Image:

```text
immutable template:
  filesystem layers
  metadata
  entrypoint/cmd
  env
  working dir
  exposed ports metadata
  user metadata
```

Container:

```text
running process using:
  image rootfs
  writable layer
  namespaces
  cgroups
  security policy
  mounts
  runtime config
```

Analogy:

```text
image = class
container = object instance
```

But more accurately:

```text
image = immutable filesystem + config
container = process tree with rootfs built from image + runtime state
```

Multiple containers can run from the same image.

Each container gets its own writable layer.

---

## 3. Image Tag vs Digest

Tag:

```text
my-app:1.0
my-app:latest
```

A tag is mutable pointer.

Digest:

```text
my-app@sha256:abc123...
```

Digest is content-addressed immutable reference.

Production best practice:

```text
Deploy by immutable digest or immutable version tags,
not floating latest.
```

Why?

- reproducibility
- rollback
- audit
- supply chain integrity
- avoid unexpected image changes

`latest` is just a tag name, not a guarantee of newest or correct.

---

## 4. OCI Image Components

OCI image generally includes:

### 4.1 Manifest

References:

- config object
- layer descriptors
- media types
- digests
- sizes

### 4.2 Config

Contains metadata:

- entrypoint
- cmd
- env
- working dir
- user
- exposed ports
- labels
- rootfs diff IDs
- history

### 4.3 Layers

Compressed filesystem diffs.

Each layer represents changes from Dockerfile/build steps.

### 4.4 Index / manifest list

Multi-platform image can point to manifests for:

- linux/amd64
- linux/arm64
- etc.

This matters for Apple Silicon vs Linux nodes.

---

## 5. Image Layers

Each layer is a filesystem diff.

Dockerfile instruction often creates a new layer:

```dockerfile
FROM eclipse-temurin:21-jre
COPY app.jar /app/app.jar
CMD ["java", "-jar", "/app/app.jar"]
```

Layer examples:

```text
base OS/JRE files
+ copied app.jar
+ metadata
```

Layers are content-addressed and cached.

If layer content unchanged, it can be reused.

This is why Dockerfile ordering matters.

---

## 6. Layer Caching for Java Builds

Bad pattern:

```dockerfile
COPY . /app
RUN mvn package
```

Any source change invalidates dependency download/build cache.

Better multi-stage pattern:

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src

COPY pom.xml .
COPY .mvn .mvn
RUN mvn -B dependency:go-offline

COPY src src
RUN mvn -B package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/app.jar app.jar
USER 10001
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Even better for Spring Boot layered jars:

- dependencies layer
- snapshot dependencies
- application classes
- resources

This improves rebuild/pull cache.

---

## 7. Deleting Files in Later Layers

Dockerfile:

```dockerfile
RUN apt-get update && apt-get install -y big-package
RUN rm -rf /var/lib/apt/lists/*
```

This creates:

- layer with apt lists
- later layer deleting them

Final merged view hides files, but previous layer still contains bytes.

Better:

```dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends big-package \
 && rm -rf /var/lib/apt/lists/*
```

within one layer.

General rule:

```text
If you add and remove large files in separate layers,
image may still contain the added bytes.
```

---

## 8. Multi-Stage Builds

Multi-stage builds separate build environment from runtime image.

Example:

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src src
RUN mvn -B package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /src/target/app.jar app.jar
USER 10001
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Benefits:

- runtime image smaller
- no Maven/cache/source in production image
- less attack surface
- faster pull
- fewer CVEs
- clearer runtime environment

---

## 9. JDK vs JRE vs jlink

### 9.1 JDK image

Includes compiler/tools.

Useful for build.

Not ideal for runtime unless tools needed.

### 9.2 JRE image

Runtime only.

Smaller.

### 9.3 jlink custom runtime

`jlink` creates minimal Java runtime with selected modules.

Benefits:

- smaller image
- reduced attack surface

Costs:

- module analysis complexity
- missing modules cause runtime failure
- harder debugging if tools absent
- framework reflection/dynamic modules need care

For production services, choose based on:

- image size
- debug needs
- security policy
- operational support

---

## 10. Distroless Images

Distroless images contain runtime and app, but not shell/package manager.

Benefits:

- smaller attack surface
- fewer packages/CVEs
- no shell for attacker
- clean runtime

Costs:

- harder debugging
- no `sh`, `ps`, `curl`, `ss`
- native library dependencies must be correct
- certificate/timezone/debug needs must be included

Debug strategy:

- ephemeral debug containers
- good logs/metrics/JFR
- reproducible local debug image
- node-level tools

---

## 11. Image Size Matters

Large images affect:

- cold start
- image pull time
- node disk usage
- registry bandwidth
- rollout speed
- autoscaling responsiveness
- CI/CD time
- vulnerability surface
- cache efficiency

But tiny image is not always best if it removes necessary diagnostics or causes complex operational failure.

Optimize for:

```text
small enough, secure enough, operable enough
```

---

## 12. Image Pull Flow

When kubelet starts pod:

1. Check if image exists locally according to pull policy.
2. Ask runtime to pull image if needed.
3. Runtime resolves tag to manifest.
4. Pulls missing layers by digest.
5. Verifies digests.
6. Unpacks layers to snapshotter storage.
7. Creates container rootfs snapshot.
8. Starts container process.

Failures can happen at each step.

---

## 13. Image Pull Policy

Kubernetes `imagePullPolicy`:

- `Always`
- `IfNotPresent`
- `Never`

Defaults depend on tag.

Common issue:

```text
Using same mutable tag with IfNotPresent means node may keep old image.
```

If using `latest`, default often Always, but using latest in production is discouraged.

Best:

```text
immutable tags or digest references
```

---

## 14. ImagePullBackOff

`ImagePullBackOff` means kubelet failed pulling image and is backing off retries.

Common causes:

- wrong image name
- wrong tag
- private registry auth missing
- image does not exist
- registry unavailable
- network/DNS issue
- rate limit
- TLS/certificate issue
- architecture mismatch
- image too large/slow
- node cannot reach registry
- proxy config issue

Debug:

```bash
kubectl describe pod <pod>
kubectl get events --sort-by=.metadata.creationTimestamp
```

Look at exact error.

Node-level if accessible:

```bash
crictl pull <image>
journalctl -u kubelet
journalctl -u containerd
```

---

## 15. Multi-Architecture Images

A tag can point to manifest list for multiple architectures.

If node is `linux/arm64` but image only has `linux/amd64`, pull/start can fail.

Check image platforms with tools like:

```bash
docker buildx imagetools inspect <image>
```

or registry tooling.

In Kubernetes mixed-arch clusters, ensure images support all node architectures or use scheduling constraints.

---

## 16. OverlayFS Mental Model

OverlayFS merges directories.

Container rootfs often:

```text
lowerdir = read-only image layers
upperdir = container writable layer
workdir  = overlayfs work directory
merged   = visible container filesystem
```

View:

```text
merged = lower layers + upper changes
```

If file exists only in lowerdir and container modifies it:

```text
copy-up lower file to upperdir, then modify upper copy
```

This is copy-on-write.

---

## 17. OverlayFS Copy-Up

Copy-up happens when writing to file from lower layer.

Example:

```text
Image layer contains /app/big.dat 1GB
Container modifies 1 byte in /app/big.dat
OverlayFS may copy file into upper layer before modification
```

Result:

- large latency spike
- writable layer grows
- disk usage increases
- unexpected performance degradation

For Java:

- do not modify app.jar in place
- do not write state into image directories
- avoid app writing to files shipped in image
- use volumes/temp dirs for mutable data

---

## 18. Whiteouts

If a file from lower layer is deleted in upper layer, overlayfs creates whiteout marker.

This hides lower file.

In image layers, deleting file creates whiteout in later layer.

The bytes may still exist in earlier layer.

This explains why deleting large file in later Dockerfile step may not reduce actual image size.

---

## 19. Container Writable Layer

Each running container has writable layer.

It stores:

- files created/modified/deleted outside mounted volumes
- runtime temporary writes to rootfs
- logs if app writes files there
- caches
- extracted native libs if path under rootfs
- accidental downloads

Problems:

- ephemeral
- can cause node disk pressure
- overlayfs overhead
- not suitable for durable state
- can be hard to inspect in Kubernetes
- may be removed on container deletion

Use volumes for deliberate writable state.

Use read-only rootfs to force discipline.

---

## 20. Volumes vs Writable Layer

Writable layer:

```text
container lifecycle scoped
overlayfs
not durable
can cause copy-up
```

Volume:

```text
explicit mount
can be emptyDir/PVC/secret/config/hostPath
clearer lifecycle and performance semantics
```

For Java:

| Use case | Recommended |
|---|---|
| app jar/classes | image layer |
| temp files | emptyDir or tmpfs with limit |
| logs | stdout/stderr or volume if required |
| heap dumps/JFR | dedicated volume |
| uploaded files | object storage/PVC depending need |
| embedded DB | PVC/local PV, not writable layer |
| config | ConfigMap/Secret |
| secrets | Secret/projected volume |

---

## 21. Runtime Stack Overview

Kubernetes node stack simplified:

```text
kubelet
  -> CRI API
    -> container runtime (containerd or CRI-O)
      -> OCI runtime (runc/crun)
        -> Linux kernel
```

Older setups used Docker via dockershim, but modern Kubernetes commonly uses containerd or CRI-O directly.

Key idea:

```text
kubelet does not usually exec your process directly.
It asks runtime to create/start containers.
```

---

## 22. kubelet

kubelet runs on each node.

Responsibilities:

- watches desired pod state from API server
- creates pod sandboxes
- pulls images through runtime
- starts/stops containers
- mounts volumes
- reports pod/container status
- runs liveness/readiness/startup probes
- manages pod lifecycle
- interacts with cgroups via runtime
- handles logs path conventions with runtime
- triggers eviction under node pressure

Debug:

```bash
journalctl -u kubelet
```

On managed clusters, direct node access may be restricted.

---

## 23. CRI

CRI = Container Runtime Interface.

It defines API between kubelet and container runtime.

Runtime implementations:

- containerd with CRI plugin
- CRI-O

Common CLI for CRI:

```bash
crictl
```

Commands:

```bash
crictl ps
crictl pods
crictl images
crictl inspect <container-id>
crictl inspectp <pod-id>
crictl logs <container-id>
crictl pull <image>
crictl stats
```

`crictl` is often more relevant than Docker CLI on Kubernetes nodes.

---

## 24. containerd

containerd manages:

- image pull/content store
- snapshots
- container metadata
- runtime tasks
- CRI plugin
- leases
- namespaces
- shims

CLI tools:

```bash
ctr
crictl
nerdctl
```

`ctr` is low-level and has namespaces, e.g.:

```bash
ctr -n k8s.io containers list
ctr -n k8s.io images list
```

Kubernetes workloads often live in containerd namespace:

```text
k8s.io
```

Use `crictl` for Kubernetes debugging when possible.

---

## 25. CRI-O

CRI-O is a Kubernetes-focused CRI runtime.

It uses OCI runtimes like runc/crun.

Debug commands still often use:

```bash
crictl
```

Logs:

```bash
journalctl -u crio
```

Conceptually similar stack:

```text
kubelet -> CRI-O -> OCI runtime -> kernel
```

---

## 26. OCI Runtime: runc/crun

OCI runtime creates container process with:

- namespaces
- cgroups
- mounts
- capabilities
- seccomp
- AppArmor/SELinux
- rootfs
- process args/env/user

`runc` is common reference implementation.

`crun` is alternative written in C, often used in some environments.

Runtime process creates container, then a shim often remains to monitor lifecycle/stdio.

---

## 27. Shim Processes

containerd uses shim processes.

Purpose:

- keep container process independent of containerd daemon
- manage stdio/logging
- report exit status
- avoid killing containers if containerd restarts

On node, `ps` may show:

```text
containerd-shim-runc-v2
```

and Java child process.

This explains process tree complexity.

---

## 28. Pod Sandbox / Pause Container

Kubernetes pod has a sandbox container, often pause.

Purpose:

- holds shared namespaces, especially network namespace
- provides stable pod namespace target
- app containers join pod sandbox namespaces

The pause container does almost nothing.

It exists so pod network namespace can exist independently of app containers.

If all app containers restart, pod sandbox can keep pod IP/namespace depending lifecycle.

Debug with:

```bash
crictl pods
crictl inspectp <pod-id>
```

---

## 29. Container Logs

Kubernetes container logs are usually stdout/stderr captured by runtime.

Application writes:

```text
stdout/stderr
```

Runtime writes log file in CRI format.

Common node path:

```text
/var/log/pods/...
/var/log/containers/...
```

Symlinks may point to runtime storage paths.

Commands:

```bash
kubectl logs <pod>
kubectl logs <pod> -c <container>
kubectl logs <pod> --previous
```

Runtime:

```bash
crictl logs <container-id>
```

Best practice for 12-factor style services:

```text
write application logs to stdout/stderr
let platform collect/rotate/ship
```

But ensure log volume is bounded.

---

## 30. CRI Log Format and Rotation

Container runtime writes logs with timestamps and stream labels.

Log rotation is handled by kubelet/runtime config.

If logs grow too fast:

- node disk pressure
- log loss after rotation
- kubelet pressure eviction
- expensive log shipping
- app slowdown if stdout pipe blocks in some setups

Java logging considerations:

- avoid massive stack traces in loops
- rate-limit repetitive errors
- async logging with bounded queue
- avoid logging sensitive data
- monitor log volume
- understand stdout backpressure behavior

---

## 31. Node Storage Layout

Node storage may contain:

- images/layers/content store
- container writable layers/snapshots
- container logs
- emptyDir volumes
- projected volumes
- kubelet pod directories
- plugin data
- CSI mounts
- runtime metadata

Common paths vary:

```text
/var/lib/kubelet
/var/lib/containerd
/var/lib/crio
/var/log/pods
/var/log/containers
```

Do not assume exact path across distros/runtime/managed clusters.

---

## 32. Ephemeral Storage in Kubernetes

Ephemeral storage includes:

- container writable layers
- logs
- emptyDir disk-backed volumes
- some runtime temporary storage

Pod can request/limit ephemeral storage:

```yaml
resources:
  requests:
    ephemeral-storage: "1Gi"
  limits:
    ephemeral-storage: "2Gi"
```

If exceeded:

- pod can be evicted
- node DiskPressure can happen
- writes may fail

For Java:

- heap dumps
- JFR files
- temp files
- logs
- upload staging
- extracted files
- local caches

must be planned.

---

## 33. DiskPressure

Node condition:

```text
DiskPressure
```

means node disk resources low.

Causes:

- too many images
- logs too large
- container writable layers
- emptyDir usage
- image GC not keeping up
- application temp file leak
- heap dumps
- old pods data
- runtime bug/config

Check:

```bash
kubectl describe node <node>
kubectl describe pod <pod>
```

Node-level:

```bash
df -h
df -i
du -xh --max-depth=1 /var/lib/kubelet
du -xh --max-depth=1 /var/lib/containerd
du -xh --max-depth=1 /var/log
```

Be careful deleting runtime files manually. Prefer kubelet/runtime GC mechanisms.

---

## 34. Image Garbage Collection

Kubelet performs image garbage collection based on disk usage thresholds.

It removes unused images/layers.

Issues:

- too many unique image tags/digests
- large images
- frequent deployments
- image pull churn
- disk pressure
- GC competing with image pulls
- slow startup after GC removes cached image

Node policy/config determines behavior.

In managed clusters, tune via provider/node config if available.

---

## 35. Container Garbage Collection

Stopped containers and dead pod data are garbage-collected.

If GC fails or pressure high:

- disk usage grows
- old logs remain
- snapshots remain
- runtime metadata grows

Debug with runtime tools:

```bash
crictl ps -a
crictl pods
crictl images
```

But avoid manual removal unless you understand runtime state and platform policy.

---

## 36. Snapshotters

containerd uses snapshotters to manage filesystem snapshots.

Common:

- overlayfs snapshotter
- native snapshotter
- devmapper/zfs/btrfs in some environments
- stargz/lazy-pull snapshotters in special setups

Snapshotter affects:

- image unpack
- startup time
- disk usage
- copy-on-write behavior
- filesystem semantics
- performance

Most Kubernetes nodes use overlayfs snapshotter.

---

## 37. Lazy Pull / Remote Snapshotters

Some systems use lazy image pulling:

- start container before entire image downloaded
- fetch files on demand
- optimize cold start for large images

Examples conceptually include stargz/nydus-like approaches.

Benefits:

- faster startup for large images if working set small

Costs:

- runtime dependency on remote content
- first access latency
- cache behavior complexity
- debugging complexity

For Java apps with large JARs/classpath, lazy pull behavior may interact with startup/class loading.

---

## 38. Java Image Layering

Spring Boot layered jars or custom Dockerfile can separate:

```text
dependencies
snapshot dependencies
resources
application classes
```

Benefit:

- dependency layer changes rarely
- app code layer changes often
- nodes reuse cached dependency layer
- faster rollout

Example Spring Boot layertools:

```bash
java -Djarmode=layertools -jar app.jar extract
```

Dockerfile can copy layers separately.

Concept:

```dockerfile
COPY dependencies/ ./
COPY spring-boot-loader/ ./
COPY snapshot-dependencies/ ./
COPY application/ ./
```

Layering matters for CI/CD and cluster pull efficiency.

---

## 39. Fat JAR vs Exploded App

Fat JAR:

- simple
- one file
- easy to run
- layer cache less granular unless layered jar

Exploded app:

- dependencies/classes separate
- better image layer caching
- potentially faster class loading in some contexts
- more files/inodes
- more complex Dockerfile

Choose based on:

- build tooling
- image cache
- startup
- operations
- framework support

---

## 40. Class Data Sharing and Images

Java CDS/AppCDS can improve startup and memory sharing.

Container image can include CDS archive.

Considerations:

- JDK version must match
- classpath/module path consistency
- build/runtime environment compatibility
- image layering
- memory mapping/page cache benefits

This is advanced but relevant for high-scale Java deployments.

---

## 41. Certificates, Timezone, Locale

Minimal images often miss:

- CA certificates
- timezone data
- locale data
- fonts
- native libraries
- shell/tools
- `/etc/passwd` entry for non-root user

Java implications:

- TLS fails due to missing CA roots
- time formatting wrong
- PDF/image/font rendering fails
- native library loading fails
- user name lookup weird
- logs show numeric UID

Include only what you need.

---

## 42. Non-Root User in Image

Dockerfile:

```dockerfile
RUN addgroup --system app && adduser --system --ingroup app app
USER app
```

or numeric:

```dockerfile
USER 10001:10001
```

Kubernetes can override:

```yaml
securityContext:
  runAsUser: 10001
  runAsGroup: 10001
  runAsNonRoot: true
```

Ensure file ownership:

```dockerfile
COPY --chown=10001:10001 app.jar /app/app.jar
```

If using numeric user, ensure paths writable/readable as needed.

---

## 43. `/etc/passwd` and Numeric UID

If image uses numeric UID without `/etc/passwd` entry:

- app can run
- some libraries may fail if they expect username lookup
- logs/tools may show numeric UID
- home directory may be missing

Java apps usually fine, but some frameworks/tools may expect:

- home dir
- user.name
- writable home cache

Set:

```bash
-Duser.home=/tmp
```

or create proper user/home if needed.

---

## 44. Image Security

Image security includes:

- small base
- trusted base image
- patching
- vulnerability scanning
- SBOM
- signing
- provenance
- no secrets in image layers
- non-root user
- minimal packages
- read-only rootfs where possible
- pinned digests
- dependency scanning
- license compliance

Never bake secrets into image.

Even if deleted later, secret may remain in previous layer.

---

## 45. Secrets in Image Layers

Bad:

```dockerfile
COPY secret.txt /app/secret.txt
RUN rm /app/secret.txt
```

Secret remains in earlier layer.

Also bad:

```dockerfile
ARG TOKEN
RUN curl -H "Authorization: $TOKEN" ...
```

Build args/history/cache can leak.

Use build secrets mechanisms:

- BuildKit secrets
- CI secret injection without committing to layer
- private dependency proxy
- runtime secrets via Kubernetes Secret/external secrets

---

## 46. SBOM and Provenance

SBOM = Software Bill of Materials.

It lists components/dependencies.

Useful for:

- vulnerability management
- compliance
- incident response
- supply chain audit

Provenance/signing tools can assert:

- who built image
- from what source
- with what build pipeline
- digest identity

For Java:

- Maven/Gradle dependency tree
- container base packages
- JDK distribution
- native libraries
- OS packages

---

## 47. Runtime Debugging: `crictl`

On Kubernetes node:

```bash
crictl pods
crictl ps
crictl ps -a
crictl images
crictl inspect <container-id>
crictl inspectp <pod-id>
crictl logs <container-id>
crictl stats
```

Useful for:

- kubelet/runtime mismatch
- container status
- image presence
- logs when kubectl unavailable
- sandbox info
- runtime errors

Need node access.

---

## 48. Runtime Debugging: `ctr`

containerd low-level:

```bash
ctr -n k8s.io containers list
ctr -n k8s.io tasks list
ctr -n k8s.io images list
```

Use carefully.

`ctr` is not Kubernetes-aware in the same user-friendly way as `crictl`.

Prefer `crictl` for CRI-level debugging.

---

## 49. Runtime Logs

Common services:

```bash
journalctl -u kubelet
journalctl -u containerd
journalctl -u crio
```

Look for:

- image pull errors
- sandbox creation errors
- CNI errors
- mount errors
- permission/security errors
- cgroup errors
- runtime crash
- log rotation issues
- disk pressure messages

Managed Kubernetes may not allow direct access; use provider logs/events.

---

## 50. Kubernetes Events

First-line debug:

```bash
kubectl describe pod <pod>
kubectl get events --sort-by=.metadata.creationTimestamp
```

Events reveal:

- FailedScheduling
- Pulling image
- Pulled image
- Failed to pull image
- Created container
- Started container
- Back-off restarting failed container
- Unhealthy probe
- FailedMount
- FailedCreatePodSandBox
- NodePressure eviction

Always read exact event messages.

---

## 51. CreateContainerError

Container cannot be created.

Common causes:

- invalid command/args
- mount path conflict
- permission denied
- missing secret/configmap
- invalid volume
- security context error
- image entrypoint problem
- runtime hook failure
- cgroup setup error
- read-only filesystem issue during runtime setup

Debug:

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
```

If container never started, logs may be absent.

Node/runtime logs may be needed.

---

## 52. CrashLoopBackOff vs ImagePullBackOff vs CreateContainerError

### 52.1 ImagePullBackOff

Image cannot be pulled.

Container not created.

### 52.2 CreateContainerError

Image may be present but runtime cannot create/start container.

### 52.3 CrashLoopBackOff

Container starts, then exits repeatedly.

Need app logs and exit code.

For Java:

- config error
- missing file
- port bind failure
- OOM
- permission denied
- bad JVM flag
- cannot load native library
- readiness/liveness killing app indirectly
- dependency startup failure

---

## 53. Java Startup and Image/Runtime

Java startup in container can be impacted by:

- image pull time
- image unpack time
- many small files/classpath
- cold page cache
- CPU throttling
- entropy/getrandom
- DNS/config dependency
- volume mount latency
- fsGroup recursive chown
- JIT warmup
- CDS availability
- APM agent instrumentation
- classpath scanning
- read-only filesystem temp path issue

Separate:

```text
time to pull image
time to create container
time to JVM start
time to app readiness
```

Kubernetes events help separate pull/create from app readiness.

---

## 54. fsGroup and Volume Ownership Startup Delay

When Kubernetes applies `fsGroup`, it may recursively change ownership/permissions on volume.

Large volume = slow startup.

Symptoms:

- pod stuck ContainerCreating
- no app logs yet
- kubelet events mention volume setup
- slow mount
- large PVC with many files

Mitigation:

- `fsGroupChangePolicy: OnRootMismatch`
- pre-provision correct ownership
- avoid huge recursive chown
- use CSI driver support
- design volume layout carefully

---

## 55. Image Pull Performance

Factors:

- image size
- number of layers
- registry latency
- node cache
- layer reuse
- compression format
- network bandwidth
- registry rate limits
- authentication latency
- multi-arch manifest resolution
- lazy pull support
- node disk speed
- unpack CPU

Optimizations:

- smaller images
- stable base layers
- layered Java app
- local registry/cache
- image pre-pull
- avoid unique huge layers per build
- avoid embedding build caches
- use digest pinning
- choose appropriate compression/lazy-pull if platform supports

---

## 56. Build Reproducibility

For reliable operations:

- pin base image digest
- lock dependencies
- deterministic builds
- avoid `latest`
- record git SHA
- include labels:
  - source repo
  - revision
  - build time
  - version
- generate SBOM
- sign image
- promote same image through environments

Do not rebuild “same version” separately for staging/prod.

Promote immutable artifact.

---

## 57. Dockerfile Best Practices for Java

Example baseline:

```dockerfile
FROM eclipse-temurin:21-jre AS runtime

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

COPY --chown=app:app target/app.jar /app/app.jar

USER app

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

More production-aware:

```dockerfile
FROM eclipse-temurin:21-jre AS runtime

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

COPY --chown=app:app dependencies/ ./
COPY --chown=app:app spring-boot-loader/ ./
COPY --chown=app:app snapshot-dependencies/ ./
COPY --chown=app:app application/ ./

USER app

ENV JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=60 -XX:+ExitOnOutOfMemoryError"

ENTRYPOINT ["java", "org.springframework.boot.loader.launch.JarLauncher"]
```

Adjust for framework/version.

---

## 58. What Not to Put in Runtime Image

Avoid:

- source code not needed
- build tools
- Maven/Gradle caches
- package manager caches
- test data
- local credentials
- `.git`
- SSH keys
- cloud credentials
- debugging tools unless intentional
- huge unused OS packages
- writable secret defaults
- private certs/keys baked into layers
- temporary build artifacts

Use `.dockerignore`:

```text
.git
target/
build/
node_modules/
*.log
.env
secrets/
```

Ensure build context doesn't include secrets.

---

## 59. Runtime Filesystem Layout for Java

Good practice:

```text
/app              read-only app files
/tmp              writable temp mount
/logs             optional writable logs/JFR/GC logs mount
/dumps            optional heap dump mount
/config           read-only config mount
/secrets          read-only secret mount
/data             durable data volume if stateful
```

With read-only rootfs:

- mount `/tmp`
- mount `/logs` if writing GC/JFR logs
- mount `/dumps`
- configure app paths

Avoid writing to `/app`.

---

## 60. Troubleshooting Disk Usage

Inside pod:

```bash
df -h
df -i
du -xh --max-depth=1 /
findmnt
```

But container may not see node runtime storage.

On node:

```bash
df -h
df -i
du -xh --max-depth=1 /var/lib/kubelet
du -xh --max-depth=1 /var/lib/containerd
du -xh --max-depth=1 /var/log
crictl images
crictl ps -a
```

Kubernetes:

```bash
kubectl describe node <node>
kubectl describe pod <pod>
```

Check:

- logs
- emptyDir
- writable layers
- images
- old containers
- heap dumps
- temp files

---

## 61. Troubleshooting ImagePullBackOff

Checklist:

```text
[ ] Exact image name correct?
[ ] Tag exists?
[ ] Registry reachable from node?
[ ] ImagePullSecret configured?
[ ] Credentials valid?
[ ] TLS certificate trusted?
[ ] Architecture supported?
[ ] Registry rate limited?
[ ] Proxy/firewall/DNS issue?
[ ] Image too large and timeout?
[ ] Pull policy expected?
```

Commands:

```bash
kubectl describe pod <pod>
kubectl get secret <pull-secret> -o yaml
kubectl get events --sort-by=.metadata.creationTimestamp
```

Node:

```bash
crictl pull <image>
journalctl -u kubelet
journalctl -u containerd
```

---

## 62. Troubleshooting Runtime Start Failure

Checklist:

```text
[ ] Did image pull?
[ ] Did sandbox create?
[ ] Did volume mount succeed?
[ ] Did container create?
[ ] Did process start?
[ ] Did process exit?
[ ] What exit code?
[ ] Is command/entrypoint correct?
[ ] Is user allowed to read app files?
[ ] Is rootfs read-only causing write failure?
[ ] Are required env/config/secrets present?
[ ] Can native libs load?
[ ] Is architecture correct?
```

Commands:

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
crictl inspect <container-id>
crictl logs <container-id>
```

---

## 63. Troubleshooting OverlayFS Copy-Up

Symptoms:

- first write to file slow
- container writable layer grows unexpectedly
- node disk grows
- app modifies files shipped in image
- latency on startup/cache update

Evidence:

```bash
findmnt -T /path
du -sh /path
```

Node/runtime inspection may be needed.

Fix:

- don't modify image files
- write to volume
- read-only rootfs
- configure app cache/temp path
- avoid unpacking into `/app`
- copy mutable templates to `/tmp` at startup if needed

---

## 64. Troubleshooting Log Disk Pressure

Symptoms:

- node DiskPressure
- pod evicted
- `/var/log/containers` large
- log collector lag
- app emits huge errors

Check:

```bash
kubectl logs <pod> --tail=100
kubectl describe node <node>
du -xh --max-depth=1 /var/log
```

Fix:

- reduce log volume
- rate limit
- configure log rotation
- avoid logging payloads/secrets
- use sampling
- fix error loop
- separate audit logs if required

---

## 65. Troubleshooting Missing Tools in Image

Distroless/minimal image issue.

Options:

- `kubectl debug` ephemeral container
- node-level `nsenter`
- temporary debug image variant
- include minimal busybox only if policy allows
- rely on app diagnostics/JFR/metrics
- use sidecar debug tools in non-prod

Do not install tools into running immutable container as normal practice.

---

## 66. Lab 1 — Inspect Image Layers

Use Docker/Podman:

```bash
docker history <image>
docker inspect <image>
```

or:

```bash
podman history <image>
skopeo inspect docker://<image>
```

Questions:

```text
Which layers are largest?
Which Dockerfile step created them?
Are secrets/build caches accidentally included?
```

---

## 67. Lab 2 — Demonstrate Layer Delete Problem

Dockerfile:

```dockerfile
FROM alpine
RUN dd if=/dev/zero of=/bigfile bs=1M count=100
RUN rm /bigfile
```

Build and inspect image size.

Then combine:

```dockerfile
FROM alpine
RUN dd if=/dev/zero of=/bigfile bs=1M count=100 && rm /bigfile
```

Compare.

Lesson:

```text
Deleting in later layer does not remove bytes from earlier layer.
```

---

## 68. Lab 3 — OverlayFS Copy-Up Concept

In container, modify file shipped by image and observe writable layer growth if runtime allows inspection.

Simpler conceptual:

```text
large file in lower layer
write 1 byte
copy-up occurs
```

For safe lab, inspect with Docker overlay2 on local machine, not production.

Lesson:

```text
copy-on-write can turn small modification into large storage cost.
```

---

## 69. Lab 4 — Entrypoint Signal Handling

Shell form:

```dockerfile
CMD java -jar app.jar
```

Exec form:

```dockerfile
CMD ["java", "-jar", "app.jar"]
```

Run both and send SIGTERM.

Observe process tree and shutdown behavior.

Lesson:

```text
PID 1 and exec form matter.
```

---

## 70. Lab 5 — Kubernetes Runtime Inspection

On test node:

```bash
crictl pods
crictl ps
crictl images
crictl inspect <container-id>
crictl logs <container-id>
```

Find pod sandbox.

Observe pause container.

Lesson:

```text
Pod is runtime sandbox + containers, not a single container.
```

---

## 71. Lab 6 — Writable Layer vs Volume

Run app that writes to:

```text
/app/output
/tmp/output
/data/output
```

Mount volume at `/data`.

Set rootfs read-only if possible.

Observe:

- writable layer fails or grows
- `/tmp` behavior depends mount
- `/data` persists according to volume lifecycle

Lesson:

```text
state should go to intentional mounts.
```

---

## 72. Production Checklist: Java Image

```text
[ ] Uses appropriate JRE/JDK/runtime base.
[ ] Does not run as root.
[ ] Uses exec-form ENTRYPOINT/CMD.
[ ] App files owned/readable by runtime UID.
[ ] No secrets in image layers.
[ ] Build caches removed in same layer or not included.
[ ] Multi-stage build used.
[ ] Image tag/digest immutable.
[ ] SBOM generated.
[ ] Vulnerability scanning in CI.
[ ] Image supports node architecture.
[ ] CA certificates/timezone/native libs included if needed.
[ ] Writable paths are explicit.
[ ] Works with read-only rootfs if target policy requires.
[ ] JVM flags configured via env safely.
[ ] Health/readiness endpoints not dependent on shell tools.
[ ] Debug strategy exists for distroless/minimal image.
```

---

## 73. Production Checklist: Kubernetes Node/Runtime Debug

```text
[ ] Read pod events first.
[ ] Determine phase: scheduling, image pull, sandbox create, container create, process start, app readiness.
[ ] Check kubelet logs if node access available.
[ ] Check runtime logs: containerd/CRI-O.
[ ] Use crictl for runtime state.
[ ] Check node DiskPressure/MemoryPressure/PIDPressure.
[ ] Check image presence and pull errors.
[ ] Check volume mount errors.
[ ] Check container exit code and previous logs.
[ ] Check log volume and ephemeral storage.
[ ] Avoid manual deletion in runtime directories unless following platform procedure.
```

---

## 74. Common Misinterpretations

### Misinterpretation 1

```text
Docker image is a tarball of final filesystem only.
```

Correction:

```text
Image is layered filesystem diffs plus metadata.
```

### Misinterpretation 2

```text
Deleting a file in Dockerfile always reduces image size.
```

Correction:

```text
If added in previous layer, bytes remain in previous layer. Delete in same layer or avoid adding.
```

### Misinterpretation 3

```text
Container writable layer is a good place for app state.
```

Correction:

```text
It is ephemeral overlay storage with copy-up overhead. Use volumes.
```

### Misinterpretation 4

```text
Docker is Kubernetes container runtime.
```

Correction:

```text
Modern Kubernetes commonly uses containerd or CRI-O via CRI. Docker CLI may not exist on node.
```

### Misinterpretation 5

```text
Pause container is useless noise.
```

Correction:

```text
Pause container holds pod sandbox namespaces, especially network namespace.
```

### Misinterpretation 6

```text
kubectl logs reads app log file inside container.
```

Correction:

```text
It reads stdout/stderr captured by runtime in node log files.
```

### Misinterpretation 7

```text
Distroless image means no debugging possible.
```

Correction:

```text
Debugging shifts to ephemeral containers, node tools, metrics, logs, JFR, and prepared diagnostics.
```

---

## 75. Invariant yang Harus Diingat

1. Image is immutable layers plus config.
2. Container is running process with image rootfs plus writable layer.
3. Tags are mutable; digests are immutable.
4. Layers are content-addressed and cached.
5. Dockerfile ordering affects cache and image size.
6. Deleting files in later layer does not remove earlier layer bytes.
7. OverlayFS merged view hides lower/upper complexity.
8. Copy-up can make small writes expensive.
9. Writable layer is ephemeral and not for durable/high-write state.
10. Volumes are explicit storage boundaries.
11. kubelet talks to runtime through CRI.
12. containerd/CRI-O talk to OCI runtime like runc/crun.
13. Pause container holds pod sandbox namespaces.
14. Kubernetes logs are captured stdout/stderr, not arbitrary app log files.
15. Node disk contains images, writable layers, logs, emptyDir, and runtime data.
16. DiskPressure can come from images, logs, emptyDir, or writable layers.
17. ImagePullBackOff root cause is in event message.
18. Distroless reduces attack surface but requires debug strategy.
19. Java image design affects startup, security, pull speed, and operability.
20. Runtime debugging starts with events, then kubelet/runtime logs, then CRI tools.

---

## 76. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa image tag tidak cukup untuk reproducible deployment?

Jawaban:

- Tag is mutable pointer.
- Registry can repoint same tag to different digest.
- Digest is content-addressed immutable identity.
- Production should use immutable tags/digests and promote same artifact.

### Q2

Kenapa menghapus secret di Dockerfile tidak cukup?

Jawaban:

- If secret was added in earlier layer, it remains in that layer.
- Later deletion only hides it in merged view.
- Anyone with image layers may recover it.
- Use build secrets and never add secrets to layers.

### Q3

Kenapa menulis ke `/app` dalam container bisa buruk?

Jawaban:

- `/app` often belongs to image lower layer.
- Modifying files triggers overlayfs copy-up.
- Writable layer grows and is ephemeral.
- Read-only rootfs would fail.
- Use `/tmp`, `/data`, or configured volume for mutable state.

### Q4

Apa peran pause container?

Jawaban:

- It holds pod sandbox namespaces, especially network namespace.
- App containers join those namespaces.
- This gives pod stable namespace even as app containers restart.

### Q5

Kenapa `kubectl logs` tetap bisa bekerja walau app tidak menulis file log?

Jawaban:

- Runtime captures stdout/stderr and writes CRI log files on node.
- `kubectl logs` reads those through kubelet/runtime, not app-specific log file.

### Q6

Bagaimana membedakan ImagePullBackOff dan CrashLoopBackOff?

Jawaban:

- ImagePullBackOff: image cannot be pulled; container did not start.
- CrashLoopBackOff: container starts and exits repeatedly.
- Use `kubectl describe pod` events and previous logs for CrashLoop.

---

## 77. Ringkasan

Part ini menghubungkan image, runtime, filesystem, dan Kubernetes node internals.

Mental model utama:

```text
Image:
  immutable layered filesystem + config

Container:
  process tree + rootfs snapshot + writable layer + namespaces/cgroups/security

Kubernetes node:
  kubelet -> CRI -> containerd/CRI-O -> runc/crun -> Linux kernel
```

Untuk Java engineer, ini menjelaskan banyak production issue:

```text
slow rollout because image too large
ImagePullBackOff due to registry/auth/arch
CrashLoop due to missing config or bad entrypoint
DiskPressure due to logs/emptyDir/writable layers
copy-up latency because app modifies image files
graceful shutdown broken due to shell CMD
distroless debugging requires ephemeral debug strategy
read-only rootfs requires /tmp/logs/dumps mounts
```

Container operability bukan hanya menulis Dockerfile yang “works on my machine”.

Ia membutuhkan:

```text
small secure reproducible image
+ correct runtime user/entrypoint
+ explicit writable paths
+ immutable artifact promotion
+ node/runtime observability
+ Kubernetes event-driven debugging
```

---

## 78. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. OCI Image Specification  
   `https://github.com/opencontainers/image-spec`

2. OCI Runtime Specification  
   `https://github.com/opencontainers/runtime-spec`

3. containerd Documentation  
   `https://containerd.io/docs/`

4. CRI-O Documentation  
   `https://cri-o.io/`

5. Kubernetes Documentation — Container Runtime Interface  
   `https://kubernetes.io/docs/concepts/architecture/cri/`

6. Kubernetes Documentation — Images  
   `https://kubernetes.io/docs/concepts/containers/images/`

7. Kubernetes Documentation — Nodes  
   `https://kubernetes.io/docs/concepts/architecture/nodes/`

8. Kubernetes Documentation — Pod Lifecycle  
   `https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/`

9. Kubernetes Documentation — Ephemeral Storage  
   `https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/`

10. Kubernetes Documentation — Debug Running Pods  
    `https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/`

11. Dockerfile Reference  
    `https://docs.docker.com/reference/dockerfile/`

12. Linux Kernel Documentation — OverlayFS  
    `https://docs.kernel.org/filesystems/overlayfs.html`

13. Spring Boot Docker/Layered Jar Documentation  
    `https://docs.spring.io/spring-boot/docs/current/reference/html/container-images.html`

14. Google Distroless Images  
    `https://github.com/GoogleContainerTools/distroless`

---

## 79. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 029 — Containers III: Images, OverlayFS, Runtime, CRI, and Kubernetes Node Internals
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-030.md
Part 030 — Production Failure Playbooks: CPU, Memory, Network, Disk, and Container Incidents
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-028.md">⬅️ Part 028 — Containers II: cgroups, CPU/Memory Limits, OOMKilled, and JVM Ergonomics</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-030.md">Part 030 — Production Failure Playbooks: CPU, Memory, Network, Disk, and Container Incidents ➡️</a>
</div>
