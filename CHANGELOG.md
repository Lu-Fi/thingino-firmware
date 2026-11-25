# Changelog

please refer to https://github.com/themactep/thingino-firmware/activity

## Unreleased (Lu-Fi fork)

- kernel 3.10 IPU (jz_ipu_v13): hold the AHB1 clock gate during each op on
  every SoC that has one (T21/T30, T31 already did; patch 0011). Before, an
  OSD blend without an open encoder (first frame after idle) stalled until
  the 100 ms timeout. Beyond vendor (vendor enables AHB1 only on T31)
  (Lu-Fi/openimp#875).
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
