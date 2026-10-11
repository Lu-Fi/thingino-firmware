#!/bin/sh
# ramoops-env.sh UENV_TXT ENABLE SIZE_KB
#
# Replaces the $(UBOOT_RAMOOPS) placeholder in the bootcmd of UENV_TXT.
# ENABLE=y: the Linux memory (osmem=<N>M@0x0) is shortened by SIZE_KB and the
#   freed area right behind it becomes the ramoops region:
#     osmem=<N*1024-SIZE_KB>K@0x0 ... ramoops.mem_address=<end of osmem>
#   The area lies between osmem and rmem, so Linux never maps it.
# otherwise: the placeholder is removed.
set -eu
f=$1; en=${2:-}; kb=${3:-128}
if [ "$en" != "y" ]; then
	sed -i 's|\$(UBOOT_RAMOOPS)||g' "$f"
	exit 0
fi
case $kb in ''|*[!0-9]*) echo "ramoops-env: bad size '$kb'" >&2; exit 1;; esac
[ "$kb" -ge 16 ] || { echo "ramoops-env: size must be >= 16 KB" >&2; exit 1; }
mb=$(sed -n 's/^osmem=\([0-9][0-9]*\)M@0x0$/\1/p' "$f" | head -n1)
if [ -z "$mb" ]; then
	k=$(sed -n 's/^osmem=\([0-9][0-9]*\)K@0x0$/\1/p' "$f" | head -n1)
	[ -n "$k" ] || { echo "ramoops-env: no osmem= line in $f" >&2; exit 1; }
else
	k=$((mb * 1024 - kb))
fi
[ "$k" -gt 4096 ] || { echo "ramoops-env: osmem too small for a ${kb} KB ramoops area" >&2; exit 1; }
addr=$((k * 1024))
size=$((kb * 1024))
con=$((size / 2))
sed -i '/^osmem=/d' "$f"
echo "osmem=${k}K@0x0" >> "$f"
args=$(printf ' ramoops.mem_address=0x%x ramoops.mem_size=0x%x ramoops.console_size=0x%x ramoops.record_size=0x4000 ramoops.dump_oops=1' "$addr" "$size" "$con")
sed -i "s|\\\$(UBOOT_RAMOOPS)|$args|g" "$f"
