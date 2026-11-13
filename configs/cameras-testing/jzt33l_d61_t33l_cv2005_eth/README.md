# JZT33L D61 test module (T33L, CV2005, Ethernet)

Bring-up profile for the T33L test module, board code `JZT33L_D61_Q38_P2P_BL`
(Ingenic PRJ008 reference layout): T33L, 64 MB DDR, 16 MB SPI NOR
(PY25Q128HA), CV2005 sensor, on-board Ethernet (RMII PHY), 3.10.14 vendor
kernel. Planned, not a release gate (openimp #392, umbrella #98 / #99).

Status: nothing in this profile has run on the module yet. It builds in the
same way as the QEMU profile `qemu_t33l`, which boots to a shell with
`tx-isp-t33.ko` and OpenIMP in QEMU `-M ingenic-t33` (see its README).

What is deliberately empty or open:

- GPIOs (no `thingino.json` or `uenv.txt` yet): to be added once the board is traced; the
  vendor firmware names no pins we can use blindly.
- Sensor module and IQ bins: the pinned `ingenic-sdk` has no T33 tree and the
  PRJ008 IQ bins are vendor files that stay local. The `cv2005` sensor module
  and bins must come from a local SDK until a T33 SDK tree is public.
- U-Boot: `soc/ingenic/t33.mk` selects `isvp_t33_sfcnor`; no T33 U-Boot has
  been built or booted. Do not flash this profile before the UART / CH341A
  recovery path of the module test plan is in place.
- The open stack comes from a local `OPEN_TX_ISP_*` / `OPENIMP_*` override
  (T33 driver and libimp are not in a release tag yet).
