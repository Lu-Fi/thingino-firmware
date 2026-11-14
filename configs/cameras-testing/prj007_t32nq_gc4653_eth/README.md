# PRJ007 test module (T32NQ, GC4653, Ethernet)

Bring-up profile for the T32 test module: board PRJ007 (vendor hardware string
`JZT32N_D41_Q38`, project `T32N_FULL_ALARM`), T32NQ per eFuse, 128 MB DDR,
16 MB SPI NOR (PY25Q128HA), GC4653 sensor, on-board Ethernet (RMII PHY,
DP83825 or SZ18201), secure boot off. Planned, not a release gate
(openimp #99). Nothing in this profile has run on the module yet.

QEMU (2026-11-14, `-M ingenic-t32`, t32nq, gc4653 model, the assembled 16 MiB
vendor-layout flash): boots to login with this layout (overlay on mtd3,
squashfs root on mtd5, `fw_printenv` from mtd1), Ethernet gets DHCP,
`tx-isp-t32.ko` with the vendor clock arguments and the local gc4653 module
load, and the OpenIMP T32 sample runs AddSensor .. H.264 5/5 streams ..
teardown without an oops.

## Vendor U-Boot stays

The module keeps its vendor U-Boot 2013.07 (Sep 04 2025). Its default
environment is compiled in and never saved:

    bootcmd=sf0 probe;sf0 read 0x81000000 0x280000 0x300000;bootm 0x81000000

So the kernel must sit at 0x280000 and be at most 3 MiB. The vendor
`bootargs` (initramfs, vendor mtdparts) do not describe thingino, so the
kernel is built with `BR2_PACKAGE_THINGINO_KOPT_CMDLINE` (CONFIG_CMDLINE +
CMDLINE_OVERRIDE) and ignores them. Partition layout (mtd numbers matter:
`fw_env.config` uses `/dev/mtd1`, root is `mtdblock5`):

| mtd | offset   | size   | name   | content                                        |
|-----|----------|--------|--------|------------------------------------------------|
| 0   | 0x000000 | 320k   | boot   | vendor U-Boot (256k) + vendor `factory` (64k), read-only |
| 1   | 0x050000 | 64k    | env    | thingino `u-boot-env.bin` (userspace only)      |
| 2   | 0x060000 | 64k    | backup | erased                                          |
| 3   | 0x070000 | 2112k  | data   | jffs2 overlay (user overlays, 32 KiB erase blocks) |
| 4   | 0x280000 | 3072k  | kernel | uImage                                          |
| 5   | 0x580000 | 10752k | rootfs | squashfs                                        |
| 6   | 0x000000 | 16384k | all    | read-only                                       |

The vendor U-Boot erases 4 KiB at 0x4f000 (inside `factory`) on every boot;
that sector is part of the read-only mtd0 and holds nothing of ours.

`mkvendorimage.sh` assembles the flash image from the module's flash backup
(first 0x50000 bytes kept) and the build's `uImage`, `rootfs.squashfs` and
`u-boot-env.bin`. The thingino full image (`thingino-<camera>.bin`, with a
thingino U-Boot and the standard layout) must NOT be flashed on this module,
and sysupgrade must stay disabled (the local overlay replaces it with a stub).

## Kernel and open stack

- Kernel: thingino-linux `T32-2.1.0-3.10.14` (vendor PRJ007 tree, 2.x ISP
  ABI), patches under `package/all-patches/linux/3.10.14/soc/t32/` (the T33
  set plus an export of `__stack_chk_guard`/`__stack_chk_fail`, which the
  vendor kernel exports and SDK sensor modules import).
- ISP: open-tx-isp `driver/t32` (`tx-isp-t32.ko`), libimp: OpenIMP T32
  (`build-t32.sh`), libsysutils/libalog: ingenic-system-libs-neo.
- ISP module arguments of the vendor `loadko.sh` (T32NQ branch):
  `clk_name=sclka clks_name=sclka clka_name=sclka clkv_name=sclka
  isp_clk=300000000 isp_clka=600000000 isp_clks=600000000 isp_clkv=600000000`.
- No streamer yet (`BR2_PACKAGE_THINGINO_STREAMER_NONE`).

## Board facts (from the vendor firmware, not measured on the module)

- Sensor GC4653, I2C 0x29 on I2C0 (PA12/PA13), reset GPIO PA20 (20), no
  power-down or power GPIO, MCLK0, MIPI (vendor app sensor table).
- IR cut PC2/PC3 (66/67); IR light PWM on PC9 (73, PWM2) and a second light
  on PC8 (72, PWM0), 20 kHz; light sensor input PB25 (57); reset button PA22
  (22, 5 s hold); alarm in PC4 (68), alarm out PC6/PC7 (70/71); USB Wi-Fi
  power PA21 (21, high). Taken from the vendor board system code for platform
  5, which matches the GPIO setup in the vendor start script; which of PC8/PC9
  is IR and which is the white light is not known.
- Optional USB Wi-Fi (AIC8800DC, a69c:88dc) in the vendor scripts; this
  profile is Ethernet only.

## Local-only parts

The GC4653 sensor module and the PRJ007 IQ bins come from the user overlay
(`THINGINO_USER_DIR/prj007_t32nq_gc4653_eth`), never from this repository:
the IQ bins are the vendor files from the module flash, and the sensor module
is the SDK's T40 `gc4653.c` ported to the T32 2.x sensor attribute layout and
built against the vendor 2.x driver headers (NDA). The module's own vendor
`sensor_gc4653_t32.ko` cannot be used: it is built for the 1.0.x ISP ABI
(`struct tx_isp_sensor` without `fsync_flag`, scalar again/dgain/integration
fields) while open-tx-isp `driver/t32` implements 2.x. The user overlay lands
in the data partition, so `mkvendorimage.sh` packs it into mtd3.
