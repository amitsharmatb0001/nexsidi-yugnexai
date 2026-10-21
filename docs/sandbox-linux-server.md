# Running the sandbox on a Linux server

The sandbox (`packages/agent-runtime/src/sandbox/container-sandbox.ts`) runs generated code in a throwaway, locked-down container.
Most layers are applied by us on every run. Two depend on how the Docker daemon on the machine is set up. This page says which, and how to set them.

## Applied on every run (no host setup)
- Private PID, network, mount, UTS and IPC namespaces; unprivileged user 65534; all capabilities dropped; no-new-privileges.
- CPU quota, memory limit (no swap) and process limit (cgroup v2).
- Disk read and write bandwidth cap (cgroup v2 `io.max`), for a block device the daemon accepts. The sandbox tries `/dev/sda`, `/dev/vda`, `/dev/nvme0n1`, `/dev/xvda`, `/dev/sdb` in turn. If none is accepted, the run goes ahead without the cap and the result says `ioLimit: "unavailable"`.
- Docker's default seccomp profile (a whitelist of allowed system calls).
- No network (`--network none`) unless a caller asks for one.
- Read-only root filesystem; writes go to a small tmpfs.
- The time limit runs inside the container as `timeout -s KILL` (a kernel interval timer), with a later host-side timer as a backstop. The container is removed when the run ends.

## Needs a daemon setting: user-namespace remap
With remap on, "root" inside a container maps to an unprivileged ID on the host. Our containers already run as user 65534, so this is a second line of defence.

1. Edit `/etc/docker/daemon.json`:
   ```json
   { "userns-remap": "default" }
   ```
2. Restart Docker: `sudo systemctl restart docker`. Existing images and containers are not visible after the switch; they are pulled again under the remapped namespace.
3. Check: the host report (`hostIsolationReport()`) lists "user-namespace remap" as active, and `docker info` shows `name=userns` under Security Options.

Side effects to know about: bind mounts into the container must be readable by the remapped user, and a few features (host networking, privileged containers) are disabled. The sandbox uses none of them.

## Turning the sandbox on for builds
On Linux the build commands run in the sandbox by default. Set `NEXSIDI_SANDBOX_BUILDS=off` to run them on the host instead, or `=on` to force it on any platform. On Windows it stays off by default because builds there are 7 to 37 times slower inside a container (bind mounts through Docker Desktop's VM).

## Checking a server
Run `hostIsolationReport()` from the same file. It reads `docker info` and lists each layer as active or missing. Do this once after setting up a server, and keep the output with the deployment notes.

## Not done
- The cap is set on one block device. A server with several disks may need the device named explicitly through `limits.ioDevice`.
- `timeout` is the container image's own program. An image without it must be run with `kernelTimer: false`, which leaves only the host-side timer.
