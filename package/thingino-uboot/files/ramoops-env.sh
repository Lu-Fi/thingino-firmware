#!/bin/sh
# Reserve a ramoops (pstore) region between the end of Linux RAM and rmem and add
# the matching ramoops.* arguments to bootcmd. Called from thingino-uboot.mk when
# BR2_THINGINO_RAMOOPS=y, after osmem/rmem were written to the uenv file.
#   usage: ramoops-env.sh UENV_TXT SOC_FAMILY SOC_RAM_MB RMEM_MB ISPMEM_MB RAMOOPS_KB
# T10/T20: area sits between osmem and ispmem. T40/T41 (nmem layout): not supported.
# Idempotent: a second run sees the ramoops args and the shortened osmem and stops.
set -e
f=$1 fam=$2 ram=$3 rmem=$4 ispmem=${5:-0} kb=${6:-128}
[ -f "$f" ] || { echo "ramoops-env: no $f" >&2; exit 1; }
case "$fam" in t40|t41|a1) echo "ramoops-env: $fam not supported" >&2; exit 1;; esac
case "$fam" in t10|t20) top=$((ram - rmem - ispmem));; *) top=$((ram - rmem));; esac
osmem_kb=$((top * 1024 - kb))
addr=$((osmem_kb * 1024))
size=$((kb * 1024))
cons=$((size / 2))
rec=$((size / 4))
if grep -q '^osmem=' "$f"; then
	sed -i "s|^osmem=.*|osmem=${osmem_kb}K@0x0|" "$f"
else
	echo "osmem=${osmem_kb}K@0x0" >> "$f"
fi
if ! grep -q '^bootcmd=.*ramoops\.' "$f"; then
	args=$(printf 'ramoops.mem_address=0x%x ramoops.mem_size=0x%x ramoops.console_size=0x%x ramoops.record_size=0x%x ramoops.dump_oops=1' $addr $size $cons $rec)
	sed -i "/^bootcmd=/ s| rmem=\${rmem}| rmem=\${rmem} ${args}|" "$f"
fi
printf 'ramoops-env: osmem=%sK@0x0 ramoops@0x%x size 0x%x (top of Linux RAM 0x%x)\n' "$osmem_kb" $addr $size $((top * 1048576))
