# PC420 (T21N/jxf23) open-stack bring-up - status

Last update: 2026-10-01 (in progress)

## Worktrees / branches (local only, nothing pushed)
- open-tx-isp: /mnt/NVMe/git/open-tx-isp-t21, branch claude/t21-bringup (base claude/open-tx-isp-all 3c9e5288)
- OpenIMP: /mnt/NVMe/git/openimp-t21, branch claude/t21-bringup (base claude/openimp-all dce07ab); no changes yet
  - standalone T21 build: build/t21/libimp.so md5 6a045ced... (matches expectation)
- thingino: /mnt/NVMe/git/thingino-ciao-t21 (detached cf463ffc3)
  - user/common + user/victure_pc420_t21n_jxf23_eth+rtl8188ftv copied from thingino-ciao-openstack; local.mk copied
  - package/open-tx-isp/0001-0003 patches git-rm'd (worktree only)
  - TODO: pin open-tx-isp.mk / openimp.mk / ingenic-sdk.mk, add 192.168.10.24/local.fragment, build

## Build state
- No thingino build started yet.
- driver/t21 builds against the PC420 kernel tree (stock output in thingino-firmware-LuFi/output/ciao/victure_pc420...-192.168.10.24), 3053 warnings, no V4L2 (CONFIG_VIDEO_V4L2 off).

## Findings so far (open-tx-isp driver/t21)
Text-relative (function-symbol) data accesses found by source + binary scans:
- tisp_channel_stop_save: store into &dump_vic_reg+0x2944 (text) -> FIXED (ch_en_value), reachable on channel attr change
- tisp_sharpen_par_refresh: read/write &get_isp_clk+8176 (text) -> OEM is sharpen gain_old; reachable (sharpen init) - TODO
- tisp_dpc_param_array_set: read &get_isp_clk+8224 -> OEM dpc gain_old - TODO
- tisp_param_operate_process (netlink): writes/reads &tisp_ae_tune+N -> OEM tisp_ae_ctrls - TODO
- tisp_set_fps (no caller): calls sensor_ctrl data as code; stores to &sensor_init+N, &tisp_ae_tune+28 -> OEM fps_control @0x80, sensor_info, tisp_ae_ctrls - TODO
- tisp_set_ag_func (only from unreachable tisp_ae_process_impl): writes tisp_ae_tune+N, PDE_DATA+0x4a7c; wrong arg layout (OEM gets IspAeTuneParam by value) - TODO (text refs)
- tisp_ae_get_luma: reads &sensor_init / tisp_s_ae_hist text -> OEM sensor_info / tisp_ae_hist - TODO
- tiziano_defog_interrupt_static (not registered): system_reg_read("BGGR" string address), tisp_init text as tispinfo, u32* arithmetic - TODO
Dropped-HI16 data mis-bindings (T23 82acd1bf class, in-bounds of tparams/d_linear): 72 refs, list in
  scratchpad .../t21/hicheck.txt (tool hicheck.py); sharpen/sdns/dpc init write -1 into tparams+0x15xx (OEM gain_old) - TODO
Not reachable: tisp_ae_process_impl/Tiziano_ae_fpga (garbage stack-arg recovery) - tisp_ae_process is a rewritten AE.

## Next
1. Fix the TODOs above, rebuild module, rerun scans.
2. T31 bug classes (poll/nonblock/mutex init/remove order/stale sensor) - in progress; OpenIMP ABI + timpsd symbol/audio checks running in subagents.
3. Thingino pins + fragment + nohup setsid build; size/content checks; report + first-boot plan (boot guard idea: per-IP overlay S10 guard keyed on u-boot env).

## Update (later 2026-10-01)
- open-tx-isp claude/t21-bringup: 5e80b943, ddf29e86 (text-relative fixes), 8ef1ad3e (framechan poll,
  nonblocking DQBUF, no -ERESTARTSYS spin, 0x2a/0x2c HLD CID swap)
- OpenIMP claude/t21-bringup: c1bd3b0 (AE luma CID 0x8000031 on T21; DisableChn waits for worker on T21)
  standalone build/t21/libimp.so md5 339de6e7...
- thingino pins bumped to those commits; ingenic-sdk pin copied from thingino-ciao-t20 (0c2aaa30, same as stock PC420 build)
- buildroot submodule had to be initialised with `git submodule update --init` (Makefile's --remote fails)
- Build running: output/build-t21-openstack.log -> output/victure_pc420_...-192.168.10.24-openstack
- Boot guard: user/<profile>/192.168.10.24/overlay/etc/init.d/S10isp-guard + local.uenv.txt isp_open=manual
  (first boot does NOT load tx-isp/sensor/timps; `/etc/init.d/S10isp-guard load` loads them; fw_setenv isp_open auto)

## Build result (2026-10-01 15:39)
- Image: output/victure_pc420_t21n_jxf23_eth+rtl8188ftv-3.10.14-uclibc-192.168.10.24-openstack/images/thingino-victure_pc420_t21n_jxf23_eth+rtl8188ftv.bin
  md5 5f655c07c609b5a774e6fb78129bc82b, sha256 3a4d8db3...; layout 320k/64k/64k/1600k/4736k/1408k (unchanged), rootfs 4700k used of 4736k
- libimp md5 339de6e7 (= standalone), tx-isp-t21.ko from open-tx-isp 8ef1ad3e, timps v1.9.29-10-g7173766 linked against it, 104/104 IMP imports exported, no vendor libimp
- modules.d identical to stock; S10isp-guard present; uenv isp_open=manual
- Rollback image copy: output/rollback/thingino-victure_pc420-stock-ciao+7391c27-20260911.bin (sha256 246d87ae...)
