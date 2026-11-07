# pstore / ramoops (kernel log across a reset)

`BR2_THINGINO_DIAG_RAMOOPS=y` (T20, T21, T23, T31; kernel 3.10.14, T31 also 4.4.94) is strictly opt-in
(default off, no camera defconfig sets it; a build without it is unchanged). Enable it per camera,
e.g. in a local fragment or your own defconfig: `BR2_THINGINO_DIAG_RAMOOPS=y` (optionally
`BR2_THINGINO_DIAG_RAMOOPS_KB=128`). It keeps the last kernel
messages over a panic, oops or watchdog reset in `/sys/fs/pstore`.

* `thingino-kopt` enables `PSTORE`, `PSTORE_CONSOLE` and `PSTORE_RAM` via `LINUX_CONFIG_FIXUPS` only with the option.
* `package/thingino-uboot/files/ramoops-env.sh` shortens `osmem` in the generated `uenv.txt` by
  `BR2_THINGINO_DIAG_RAMOOPS_KB` (default 128 KB, written as `osmem=<n>K@0x0`) and adds
  `ramoops.mem_address/mem_size/console_size/record_size/dump_oops` to the bootargs. The area sits
  between `osmem` and `rmem` (T20/T21: between `osmem` and `ispmem`), so Linux never maps it.
  Example (T23, 64 MB, rmem 22M): `osmem=42880K@0x0`, `ramoops.mem_address=0x29e0000`.
* `/etc/init.d/S01pstore` (installed only with the option) mounts `pstore` on `/sys/fs/pstore`.

Whether the SoC's DRAM keeps its content across a watchdog reset is not documented; test it:

1. Boot, `echo c > /proc/sysrq-trigger` (panic, `panic=` seconds later the board resets).
2. After the reboot `ls /sys/fs/pstore`: `console-ramoops-0` and `dmesg-ramoops-0` hold the old log.
3. Same with the watchdog: stop feeding `/dev/watchdog` and compare.

An existing device keeps its old U-Boot environment; a full OTA that rewrites the env, or
`fw_setenv`, is needed to get the new `osmem` and bootargs.

## Reset diagnostics options (thingino-kopt, menu "Diagnostics")

All default off; upstream defconfigs set none of them. Enable them per camera in a
user fragment (`THINGINO_USER_DIR/<camera>/local.fragment`) or your own defconfig.
Kernel 3.10 only.

| Option | SoC | Kernel options / files | Cost |
|---|---|---|---|
| `BR2_THINGINO_DIAG_RESETCAUSE` | all 3.10 | `PANIC_ON_OOPS`, hung-task detection 120 s with panic, `LOG_BUF_SHIFT=17`; `S02resetcause` | none at runtime |
| `BR2_THINGINO_DIAG_LASTPANIC` | T23, T31 | `JZ_DIAG_LASTPANIC` (patch 0107), `KALLSYMS` off; record in RTC RTCSAR, `/proc/diag_lastpanic` | none |
| `BR2_THINGINO_DIAG_RESET_SLED` | T23 | `JZ_DIAG_EPC_SLED` (patch 0108): reset PC `A0xxxxxx` in the boot log encodes the panic class/location | none |
| `BR2_THINGINO_DIAG_RAMOOPS` (+ `_KB`, `_LOW_MB`) | T20, T21, T23, T31 | `PSTORE`, `PSTORE_CONSOLE`, `PSTORE_RAM`; `S01pstore`; osmem carve-out + `ramoops.*` bootargs | 256 KB RAM |
| `BR2_THINGINO_DIAG_SAMPLER` | all | `S41diag-sampler`: one load/memory/IRQ line every 10 s to syslog | syslog traffic |
| `BR2_THINGINO_DIAG_KDEBUG` | all 3.10 | `DEBUG_PREEMPT`, `DEBUG_ATOMIC_SLEEP`, `DEBUG_STACKOVERFLOW` (+ do_IRQ preempt/stack check, patch 0109), `DEBUG_STACK_USAGE`, `SLUB_DEBUG` | CPU per preempt/IRQ, kernel size |

* `S02resetcause` logs `CPM_RSR` (0x10000008: power-on, WDT, hibernate), the `/proc/diag_lastpanic`
  record (`PANIC reason=... epc=...`, `RESTART`, `NORECORD`, `SLED class=...`) and, with ramoops, saves
  the pstore files to `/tmp/diag-lastreset` (and `/opt/diag-lastreset` when writable). All lines go to
  syslog with tag `resetcause`, again after 120 s for the remote syslog host.
* Resolve logged addresses on the host with `mipsel-linux-nm -n` of the build's `vmlinux` or
  `System.map` (no KALLSYMS on the camera).
* Measured: DRAM does not survive the watchdog reset on T10, T23 and T31, so ramoops only helps across
  a warm restart there. The RTCSAR record (LASTPANIC) and the reset PC sled survive it.
