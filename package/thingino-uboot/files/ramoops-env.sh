#!/bin/sh
# Reserve a ramoops (pstore) region between the end of Linux RAM and rmem and add
# the matching ramoops.* arguments to bootcmd. Called from thingino-uboot.mk when
# BR2_THINGINO_DIAG_RAMOOPS=y, after osmem/rmem were written to the uenv file.
#   usage: ramoops-env.sh UENV_TXT SOC_FAMILY SOC_RAM_MB RMEM_MB ISPMEM_MB RAMOOPS_KB [LOW_MB]
# LOW_MB > 0: put the region (plus a 64 KB untouched test window behind it) at LOW_MB
# inside Linux RAM, as a hole between two mem= ranges. Needed because U-Boot 2013.07
# (arch/mips/lib/board.c, mem_malloc_init) zeroes its 32 MB malloc arena just below
# its relocation address at the top of the first 64 MB on every boot, which covers
# the default place at the end of osmem. LOW_MB must stay below that arena.
# T10/T20: area sits between osmem and ispmem. T40/T41 (nmem layout): not supported.
# Idempotent: a second run sees the ramoops args and the shortened osmem and stops.
set -e
f=$1 fam=$2 ram=$3 rmem=$4 ispmem=${5:-0} kb=${6:-128} low=${7:-0}
[ -f "$f" ] || { echo "ramoops-env: no $f" >&2; exit 1; }
case "$fam" in t40|t41|a1) echo "ramoops-env: $fam not supported" >&2; exit 1;; esac
case "$fam" in t10|t20) top=$((ram - rmem - ispmem));; *) top=$((ram - rmem));; esac
size=$((kb * 1024))
if [ "$low" -gt 0 ]; then
	# hole = ramoops + 64 KB test window; Linux RAM = [0, low) + [hole end, top)
	[ "$low" -le 28 ] || { echo "ramoops-env: LOW_MB $low too high (U-Boot malloc arena)" >&2; exit 1; }
	hole_kb=$((kb + 64))
	addr=$((low * 1048576))
	rest_kb=$((top * 1024 - low * 1024 - hole_kb))
	osmem_val=$(printf '%sM@0x0 mem=%sK@0x%x' $low $rest_kb $((addr + hole_kb * 1024)))
else
	osmem_kb=$((top * 1024 - kb))
	addr=$((osmem_kb * 1024))
	osmem_val="${osmem_kb}K@0x0"
fi
cons=$((size / 2))
rec=$((size / 4))
if grep -q '^osmem=' "$f"; then
	sed -i "s|^osmem=.*|osmem=${osmem_val}|" "$f"
else
	echo "osmem=${osmem_val}" >> "$f"
fi
if ! grep -q '^bootcmd=.*ramoops\.' "$f"; then
	args=$(printf 'ramoops.mem_address=0x%x ramoops.mem_size=0x%x ramoops.console_size=0x%x ramoops.record_size=0x%x ramoops.dump_oops=1' $addr $size $cons $rec)
	sed -i "/^bootcmd=/ s| rmem=\${rmem}| rmem=\${rmem} ${args}|" "$f"
fi
printf 'ramoops-env: osmem=%s ramoops@0x%x size 0x%x (top of Linux RAM 0x%x)\n' "$osmem_val" $addr $size $((top * 1048576))
