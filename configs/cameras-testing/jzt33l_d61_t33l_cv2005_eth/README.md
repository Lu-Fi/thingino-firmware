# JZT33L D61 test module (T33L, CV2005, Ethernet)

Bring-up profile for the T33L test module, board code `JZT33L_D61_Q38_P2P_BL`
(Ingenic PRJ008 reference layout "Goat"): T33L, 64 MB DDR, 16 MB SPI NOR
(PY25Q128HA), CV2005 sensor on I2C0 (address 0x35), on-board Ethernet (RMII,
TI DP83825 PHY), 3.10.14 vendor kernel. Planned, not a release gate
(openimp #392, #393, umbrella #98 / #99).

## Boot: vendor U-Boot, vendor-boot layout

No open T33 U-Boot exists. The module keeps its vendor U-Boot
(`U-Boot 2013.07-H20260203a`, board PRJ008). That U-Boot has no saved
environment (it prints "bad CRC, using default environment") and always runs

    sf0 probe; sf0 read 0x80600000 0x250000 0x200000; bootm 0x80600000

with bootargs for the vendor partition table. This profile therefore builds
the kernel with a built-in command line that overrides the firmware one
(`vendorboot.kernel.config`): vendor memory split (`mem=52832K@0x0
rmem=12704K@0x3398000`) and this partition table:

| mtd | name    | offset   | size  | content                                   |
|-----|---------|----------|-------|-------------------------------------------|
| 0   | boot    | 0x000000 | 256k  | vendor U-Boot, never written               |
| 1   | env     | 0x450000 | 64k   | thingino env (`/dev/mtd1 0x0 0x8000`)     |
| 2   | kernel  | 0x250000 | 2048k | uImage, where the vendor U-Boot reads it  |
| 3   | rootfs  | 0x460000 | 6080k | squashfs (`root=/dev/mtdblock3`)          |
| 4   | data    | 0xa50000 | 5824k | jffs2 overlay                             |
| 5   | all     | 0x000000 | 16M   |                                           |
| 6   | factory | 0x040000 | 64k   | vendor licence block, read-only           |
| 7   | config  | 0x050000 | 2048k | vendor config jffs2, read-only (rollback) |

Everything thingino writes lies at or above 0x250000, i.e. inside the vendor
kernel/rootfs/media/appfs partitions; U-Boot, factory and config stay as they
are, so the vendor firmware can be restored by rewriting 0x250000-0xffffff
only.

Consequences:

- `thingino-jzt33l_d61_t33l_cv2005_eth.bin` from `make` is NOT flashable: its
  first 256 KiB come from a placeholder U-Boot board (`isvp_t31_sfcnor`, only
  so the image packs) and its layout is the thingino one. The flashable image
  is composed from the build output and the module's own flash backup (kernel
  at 0x250000, env at 0x450000, rootfs at 0x460000, data at 0xa50000).
- `sysupgrade` / OTA from the camera write the thingino layout including the
  boot partition and must not be used on this module.
- The rootfs must stay below 6080 KiB and the uImage below 2 MiB.

## Build

The T33 open stack is on the `next` branches of open-tx-isp (`driver/t33`)
and OpenIMP (`build-t33.sh`), not in a release tag yet, so pin them by
version (GitHub SITE as in the packages; the package hashes only cover the
release tags):

    make CAMERA=jzt33l_d61_t33l_cv2005_eth GROUP=testing TOOLCHAIN_LIBC=uclibc \
      OPEN_TX_ISP_VERSION=<open-tx-isp next sha> OPENIMP_VERSION=<openimp next sha> \
      BR_NO_CHECK_HASH_FOR="open-tx-isp-<sha>-git4.tar.gz openimp-<sha>-git4.tar.gz"

## Board data (from the vendor flash, not yet measured on the module)

- ISP module arguments of the vendor `loadko.sh` for T33L:
  `clk_name=mpll isp_clk=325000000 clkv_name=mpll isp_clkv=325000000
  direct_mode=1 ivdc_mem_line=1080 ivdc_threshold_line=800` (the thingino
  Kconfig has no 325 MHz ISP clock; pass them via `/etc/modules.d/20-isp`).
- IR cut: GPIO 66 / 67 (PC2 / PC3), outputs (vendor HAL `IniteIrcut`).
- IR LEDs: PWM driven by the vendor (PWM channel 2 on GPIO 73 / PC9, second
  channel on GPIO 72 / PC8); `ir850` = 73 as a plain GPIO is a guess.
- Day/night photo sensor input: GPIO 57 (PB25).
- Factory-reset button: GPIO 22 (PA22), input (`gpio_button`).
- Alarm in: GPIO 68 (PC4); alarm out: GPIO 70 / 71 (PC6 / PC7); one more
  output at GPIO 59 (PB27) set low at IR init (purpose unknown).
- Status LEDs and the AIC8800 (USB, D80) power/reset: not found in the vendor
  board code; no WiFi in this profile (Ethernet only, the kernel config has no
  cfg80211).

What is deliberately empty or open:

- Sensor module and IQ bins: the pinned `ingenic-sdk` has no T33 tree and the
  PRJ008 IQ bins are vendor files. The vendor `sensor_cv2005_t33.ko` and the
  `cv2005-PRJ008-*.bin` files must come from a local user overlay.
- No streamer (`THINGINO_STREAMER_NONE`): the first module run is the ISP +
  OpenIMP bring-up, not a camera image.
