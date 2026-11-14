# JZT33L D61 test module (T33L, CV2005, Ethernet)

Bring-up profile for the T33L test module, board code `JZT33L_D61_Q38_P2P_BL`
(Ingenic PRJ008 reference layout "Goat"): T33L, 64 MB DDR, 16 MB SPI NOR
(PY25Q128HA), CV2005 sensor on I2C0 (address 0x35), on-board Ethernet (RMII,
TI DP83825 PHY), 3.10.14 vendor kernel. Planned, not a release gate
(openimp #392, #393, umbrella #98 / #99).

## Boot: thingino U-Boot, standard thingino layout

The module runs fully on thingino (user decision 2026-11-14): U-Boot 2026.07
(`BR2_THINGINO_UBOOT_VERSION_2026_07`, board `isvp_t33_sfcnor` = SOC_UBOOT of
`soc/ingenic/t33.mk`) and the standard 16 MiB NOR layout:

| mtd | name    | offset   | size    |
|-----|---------|----------|---------|
| 0   | boot    | 0x000000 | 320k    |
| 1   | env     | 0x050000 | 64k     |
| 2   | backup  | 0x060000 | 64k     |
| 3   | kernel  | 0x070000 | 1600k   |
| 4   | rootfs  | 0x200000 | 2752k   |
| 5   | data    | 0x4b0000 | 11584k  |

U-Boot details for this board:

- T33L DDR2 650 MHz profile (APLL 950 / MPLL 1300, as the vendor log). The
  uMCTL2 timing/refresh/DFI/ODT words equal the vendor SPL; the address map is
  taken from the vendor SPL (patch 0004).
- SPL console UART clock gate is CLKGR0 bit 11 + n on T33 (patch 0005; without
  it the SPL hangs on its first character).
- PY25Q128HA (0x852018) is in the SPI NOR id table; U-Boot has no Ethernet on
  T33 (no tftp from U-Boot), recovery is the SPI clip.
- Memory: `BR2_THINGINO_RMEM_MB=13` (mem=51M rmem=13M@0x3300000); the vendor
  uses mem=52832K rmem=12704K@0x3398000, thingino works in whole MB, 13 MB
  covers the vendor reservation.
- Ethernet: TI DP83825 RMII PHY at MDIO address 0 (id 0x2000/0xa140, reset
  PB26 active low). The GMAC clock (CPM MACCDR) must run at 50 MHz like the
  vendor kernel (kernel patch soc/t33/0007); with the generic 25 MHz the
  first hardware boot got no DHCP lease on a known-good port.
- MAC: keep the module's factory MAC by setting `ethaddr` (local.uenv.txt) and
  `eth.mac` (thingino.json) in the user dir; S03mac otherwise generates one.

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
  Kconfig has no 325 MHz ISP clock; pass them via `/etc/modules.d/20-isp`;
  the open driver runs with `direct_mode=0` until #509 is fixed).
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
- Streamer: timps (the fleet's open-stack streamer) since 2026-11-14 (#511).
  The local overlay supplies `/etc/timps.conf` with `sensor.model = cv2005`,
  `sensor.i2c_addr = 0x35`, 1920x1080@25 (the open sinfo does not fill
  `/proc/jz/sensor/sensor0/name`, so timps cannot detect the sensor), the
  `/etc/sensor -> /usr/share/sensor` link (OpenIMP T33 reads
  `/etc/sensor/cv2005-PRJ008-<mode>.bin`; with sensor "none" the SDK package
  does not create the link) and `20-isp` with `direct_mode=0`
  (direct_mode=1 hangs the T33L, openimp #509).
