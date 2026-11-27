# Changelog

please refer to https://github.com/themactep/thingino-firmware/activity

## Unreleased (Lu-Fi fork)

- Cinnado D1 T41NQ: SD card detect on PB26 (active low, pull-up), the pin
  the stock firmware uses (kernel 3.10 jz_mmc0_pdata: cd_type GPIO,
  ext_cd_gpio 58). The family tree pin PB27 is not wired on this board, and
  the broken-cd polling used instead rescanned the empty slot every second:
  ~47 mmc0 IRQ/s, "Got command interrupt ... no command operation" about
  every 10 s and "error -22 whilst initialising SDIO/MMC card" (CMD5/CMD1
  answers from line noise) about every 45 s. With the GPIO the host stays
  idle until a card is inserted, like the vendor (Lu-Fi/openimp#951).

- kernel 4.4.94 T32 (sdhci-ingenic): the same leak as on T41 fixed
  (patch soc/t32/0003). sdhci_ingenic_set_clock() called devm_clk_get() on
  every clock change; the mux clock is already held from probe, so the lookup
  is dropped. Only compile-checked (no T32 4.4.94 image exists yet,
  Lu-Fi/openimp#953).

- kernel 4.4.94 T41: reset-surviving last-panic record (patch soc/t41/0003,
  kernel option JZ_DIAG_LASTPANIC). Oops, panic, hung task and restart reason,
  uptime bucket and epc/comm are kept in RTC RTCSAR and shown as
  /proc/diag_lastpanic after the next boot; jz_wdt_restart() commits the
  record. BR2_THINGINO_DIAG_RESETCAUSE and BR2_THINGINO_DIAG_LASTPANIC now
  also accept T41 on kernel 4.4.94 (S02resetcause logs the record to syslog).
  Off by default. RTCSAR channel only; build-checked, not yet measured on T41
  hardware (Lu-Fi/openimp#952).

- kernel 4.4.94 T41 (sdhci-ingenic): the MSC mux clock is looked up once in
  probe instead of with a clk_get() on every clock change (patch
  soc/t41/0002). Each call left a 128 byte struct clk behind. A polled SD slot
  without a card (broken-cd, e.g. Cinnado D1 T41NQ) rescans every second and
  lost about 120 KB of kernel slab per minute, which ended in an OOM and a
  watchdog reset after about 4 h. Measured on the camera with a call counter:
  940 calls/min before and after, SUnreclaim +114 KB/min before, flat after.
  The vendor driver has the same leak (Lu-Fi/openimp#950, #949).

- libaudioprocess-neo: pinned to the Lu-Fi fork (branch aperto, 9f71acc). The
  WebRTC AEC no longer starts with the 12 ms far-end rewind of its startup
  phase; the Ingenic driver reference is already time-aligned. Before, about
  half of the AEC sessions on the T10 never locked (flat ~20 dB instead of
  33-41 dB echo reduction), on both the vendor and the open stack. Beyond
  vendor (Lu-Fi/openimp#640).
- kernel 3.10 IPU (jz_ipu_v13): hold the AHB1 clock gate during each op on
  every SoC that has one (T21/T30, T31 already did; patch 0011). Before, an
  OSD blend without an open encoder (first frame after idle) stalled until
  the 100 ms timeout. Beyond vendor (vendor enables AHB1 only on T31)
  (Lu-Fi/openimp#875).
- kernel 3.10 IPU patch 0011: the AHB1 hold is compiled out on T23 (the IPU sits on AHB0
  there and struct jz_ipu has no ahb1_gate member); the first version broke the T23 kernel build
  (Lu-Fi/openimp#901).
- kernel 3.10 IPU (jz_ipu_v13, all xburst1 SoCs): the wedge retry now
  re-programs the op after its stop/reset (patch 0010). Before, the retry
  fired an empty op, logged "recovered after reset+retry" and returned
  success although nothing was blended (Lu-Fi/openimp#875).
- thingino-button / kernel 3.10: a lost key release can no longer arm the
  20 s factory reset. XBurst1 GPIO both-edge emulation re-arms until the pin
  level is stable, gpio-keys re-checks a pressed key every 50 ms, and
  thingino-button drops holds the kernel no longer reports and measures
  holds with the monotonic clock. S15thingino-button records the real pid
  (`-s` instead of `-d`) and `stop`/`restart` no longer leave a daemon
  behind. See docs/thingino/reset-button.md.
