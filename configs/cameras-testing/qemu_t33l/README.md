# qemu_t33l: QEMU `-M ingenic-t33` profile (T33L, open stack)

Desk profile for the T33 (PRJ008): vendor 3.10.14 kernel from thingino-linux
(`T33-2.0.2.1-3.10.14`, patched under `package/all-patches/linux/3.10.14/soc/t33/`),
open-tx-isp `driver/t33` (`tx-isp-t33.ko`) and OpenIMP (`build-t33.sh`,
libimp for the 2.0.2.1 API line). No streamer, no audio, no WiFi.
Planned, not a release gate (openimp #392, #98, #99).

Build (open-stack T33 sources are not in a release tag yet, so use a SITE
override to checkouts that contain them):

    make CAMERA=qemu_t33l GROUP=testing TOOLCHAIN_LIBC=uclibc \
      OPENIMP_SITE=<openimp checkout> OPENIMP_SITE_METHOD=git OPENIMP_VERSION=<sha> \
      OPEN_TX_ISP_SITE=<open-tx-isp checkout> OPEN_TX_ISP_SITE_METHOD=git OPEN_TX_ISP_VERSION=<sha>

Open items: the pinned `ingenic-sdk` has no T33 tree, so no `cv2005` sensor
module is built (the QEMU image-sensor model needs one for frames; loading the
ISP module and libimp does not); the PRJ008 IQ bins are vendor files kept local.
