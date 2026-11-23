# 32 MB boards: BR2_THINGINO_LOWMEM

Boards with 32 MB DDR (kernel 3.10, ~19-20 MB for Linux) run the full open
stack only with the low-memory tuning of `BR2_THINGINO_LOWMEM`
(package `thingino-kopt`). No feature is removed.

## Why (Lu-Fi/openimp#800)

On the O-KAM QC3 (T23DL) with all features on, a second browser (WebUI tab
with its heartbeat CGI + a WebRTC viewer) made the board reset by the
hardware watchdog. The kernel had no swap, so only clean file pages were
reclaimable, and on the squashfs rootfs those are the program text. Once the
page cache fell below the working set (about 3.3 MiB), every page fault
re-read and XZ-decompressed a 128 KiB squashfs block; reclaim always "made
progress", so the 3.10 OOM killer never ran, the watchdog daemon did not get
to feed `/dev/watchdog` for 60 s, and the board reset (reset PCs inside
`putback_inactive_pages`, `grab_super_passive`, the scheduler).

## What the option does

| Part | Setting |
|------|---------|
| kernel | LOG_BUF_SHIFT 16, logger 64 KiB, JFFS2 small deflate window (#785); ZRAM + LZ4, VM event counters, Android low-memory killer (STAGING, ANDROID; staging dwc2 off, the SoC USB is USB_JZ_DWC2) |
| busybox | mkswap, swapon, swapoff |
| S03lowmem | tcp_mem 192/256/384, dirty 256 KiB/1 MiB, watchdog daemon oom_score_adj -1000; 4 MiB `/dev/zram0` swap (LZ4, priority 100), swappiness 100, page-cluster 0, min_free_kbytes 768; LMK: kill oom_score_adj >= 800 below 896 pages (3.5 MiB) of file cache |
| auth.sh (target-finalize) | every WebUI CGI sets its own oom_score_adj to 800 (helpers and curl inherit it) |
| S61lowmem | uhttpd kept at <= 0 (the killer must never take the server: WebUI gone until reboot); wpa_supplicant and dropbear -500 |
| S95timps | timpsd oom_score_adj -500 (only with /etc/lowmem) |

The QC3 profile also moves 1 MiB from rmem to Linux (`BR2_THINGINO_RMEM_MB=7`,
mem=25M rmem=7M): OpenIMP needs 6.7-7 MiB there with both streams, JPEG and
OSD (6 MiB fails with a clean "rmem budget exceeded" message, 7 MiB runs all
features).

Under overload the board now drops a WebUI request (the low-memory killer
logs `select '<name>' ... to kill` in dmesg) instead of resetting.
Streamer-side admission control (refusing an extra viewer when memory is low)
belongs to timps.

## Checking a board

```
cat /proc/swaps; cat /sys/block/zram0/mem_used_total
cat /sys/module/lowmemorykiller/parameters/{adj,minfree}
grep -E 'pgmajfault|pswp|allocstall' /proc/vmstat
dmesg | grep -i 'to kill'
```
