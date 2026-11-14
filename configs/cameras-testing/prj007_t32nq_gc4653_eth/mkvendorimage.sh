#!/bin/sh
# Assemble a flash image for the PRJ007 T32NQ test module that keeps the
# module's vendor U-Boot (2013.07, fixed bootcmd: sf0 read 0x81000000
# 0x280000 0x300000; bootm). Only the area from 0x50000 up is ours.
#
# Layout (must match BR2_PACKAGE_THINGINO_KOPT_CMDLINE in the defconfig, the
# kernel ignores the vendor bootargs):
#   0x000000  320k  boot    vendor U-Boot 256k + vendor "factory" 64k (ro)
#   0x050000   64k  env     thingino u-boot-env.bin (userspace fw_printenv only)
#   0x060000   64k  backup  erased
#   0x070000 2112k  data    jffs2 overlay: the build's user overlays
#                           (<build>/data/overlay), 32 KiB erase blocks
#   0x280000 3072k  kernel  thingino uImage (vendor U-Boot reads 0x300000 here)
#   0x580000 10752k rootfs  thingino rootfs.squashfs
#
# usage: mkvendorimage.sh <flash-backup.bin> <build output dir> <out dir>
# writes <out>/full16m.bin (whole chip, first 0x50000 = backup bytes) and
# <out>/from50000.bin (0x50000..end, for a U-Boot sf update at 0x50000).
set -eu
backup=$1 build=$2 out=$3
images=$build/images

die() { echo "mkvendorimage: $*" >&2; exit 1; }
size() { stat -c %s "$1"; }

[ "$(size "$backup")" -eq 16777216 ] || die "backup is not 16 MiB"
for f in uImage rootfs.squashfs u-boot-env.bin; do
	[ -f "$images/$f" ] || die "missing $images/$f"
done
[ "$(size "$images/uImage")" -le $((0x300000)) ] || die "uImage > 3 MiB (vendor bootcmd reads 0x300000)"
[ "$(size "$images/rootfs.squashfs")" -le $((10752 * 1024)) ] || die "rootfs > 10752k"
[ "$(size "$images/u-boot-env.bin")" -le $((0x10000)) ] || die "env > 64k"

mkdir -p "$out"
# data partition: the thingino data.jffs2 is padded to the thingino layout,
# so pack the same overlay tree again for our 2112k partition. The SFC NOR
# driver of this kernel reports 32 KiB erase blocks (CONFIG_ERASE_SIZE_32K).
data=$out/data.jffs2
if [ -d "$build/data/overlay" ]; then
	"$build/host/sbin/mkfs.jffs2" --little-endian --squash --eraseblock=32768 \
		--pad=$((2112 * 1024)) --root="$build/data/overlay/" --output="$data"
	[ "$(size "$data")" -le $((2112 * 1024)) ] || die "data.jffs2 > 2112k"
fi
img=$out/full16m.bin
# start from an erased chip, then lay the pieces in
tr '\000' '\377' < /dev/zero | head -c 16777216 > "$img"
# all offsets are 64 KiB aligned
put() { dd if="$1" of="$img" bs=65536 seek=$(($2 / 65536)) conv=notrunc status=none; }
dd if="$backup" of="$img" bs=4096 count=$((0x50000 / 4096)) conv=notrunc status=none
put "$images/u-boot-env.bin" 0x50000
[ -f "$data" ] && put "$data" 0x70000
put "$images/uImage" 0x280000
put "$images/rootfs.squashfs" 0x580000
dd if="$img" of="$out/from50000.bin" bs=4096 skip=$((0x50000 / 4096)) status=none

cmp -n $((0x50000)) "$img" "$backup" || die "vendor area differs from the backup"
md5sum "$img" "$out/from50000.bin"
printf 'crc32 full16m: '; python3 -c "import zlib,sys;print('%08x'%(zlib.crc32(open(sys.argv[1],'rb').read())&0xffffffff))" "$img"
printf 'crc32 from50000: '; python3 -c "import zlib,sys;print('%08x'%(zlib.crc32(open(sys.argv[1],'rb').read())&0xffffffff))" "$out/from50000.bin"
