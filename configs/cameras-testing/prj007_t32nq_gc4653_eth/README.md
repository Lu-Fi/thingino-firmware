# PRJ007 test module (T32NQ, GC4653, Ethernet)

Bring-up profile for the T32 test module: board PRJ007 (vendor hardware string
`JZT32N_D41_Q38`, project `T32N_FULL_ALARM`), T32NQ per eFuse, 128 MB DDR,
16 MB SPI NOR (PY25Q128HA), GC4653 sensor, on-board Ethernet (RMII PHY,
DP83825 or SZ18201), secure boot off. Planned, not a release gate
(openimp #99). Nothing in this profile has run on the module yet.

Full thingino boot (2026-11-14, user decision): thingino U-Boot 2026.07
(`isvp_t32nq_sfcnor`, TPL + SPL + U-Boot) and the standard thingino 16 MiB
layout replace the vendor U-Boot and layout. The module is flashed with a
CH341A clip (whole chip); recovery is the clip and the module's flash backup.

## U-Boot

- Clocks and DDR3 from the vendor SPL (U-Boot 2013.07-H20250211a, flash
  0x0-0x8000) and the register state it leaves (QEMU run of the vendor
  flash): CPU 1000 MHz, MPLL 800 MHz, DDR CK 400 MHz, AHB 200 / PCLK 100 MHz,
  CL 11 / CWL 8 (uboot patch 0006). The T32NQ preset (1200 / 450 MHz, CL 13)
  was never run on T32 silicon. Address map was already equal.
- Console UART1 ungated at CLKGR0 bit 12 (vendor SPL clears bit 11 + n,
  same as thingino's T32 code).
- Flash PY25Q128HA (JEDEC 0x852018, vendor U-Boot on the module prints
  "Detected PY25Q128HA"), in the thingino id table, CONFIG_SPI_FLASH_PUYA.
- Environment at 0x50000 (64 KiB). bootargs mem=72M@0x0 rmem=56M@0x4800000
  (= vendor mem=73728K rmem=57344K@0x4800000).

## Layout (standard thingino 16 MiB NOR, mtdparts=sfc0_nor)

boot 0x000000 320k | env 0x050000 64k | backup 0x060000 64k | kernel
0x070000 1600k | rootfs 2816k | data (jffs2 overlay) rest | all 16M.
The vendor factory (licence) block at 0x40000 and the vendor config/app
partitions are overwritten; they exist only in the flash backup.

## Ethernet

The vendor kernel always runs the GMAC divider at 50 MHz (RMII reference);
this tree set 25 MHz (kernel patch soc/t32/0008). PHY at MDIO address 0,
DP83825 (id 0x282000) or SZ18201 per the vendor driver checks; not measured.
The vendor firmware sets no fixed MAC (NetWork.json has none; its script
falls back to a random one). The local overlay sets ethaddr / eth.mac.

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
in the data partition.
