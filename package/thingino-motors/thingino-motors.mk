# Pinned to Lu-Fi's fork, not upstream thingino/thingino-motors, while the
# WebSocket PTZ control path (BR2_PACKAGE_THINGINO_MOTORS_WS below) lives only
# on this branch there - same reasoning and same pattern as package/timps/
# timps.mk pointing at Lu-Fi/timps instead of some upstream. VERSION is a raw
# commit hash (this repo's existing convention even before this fork, see the
# git blame on this line) rather than a tag, so SITE_BRANCH is cosmetic - git
# fetches the exact commit regardless of which branch currently has it - kept
# here only as a human pointer to where this hash lives.
# TODO: retarget at upstream thingino/thingino-motors (or drop this comment
# and the fork pin) once/if the WS work is upstreamed there instead.
THINGINO_MOTORS_SITE_METHOD = git
THINGINO_MOTORS_SITE = https://github.com/Lu-Fi/thingino-motors.git
THINGINO_MOTORS_SITE_BRANCH = feature/websocket-daemon
THINGINO_MOTORS_VERSION = 918213a2bfe2036e8d4b0298dfaf8da2be842c79
THINGINO_MOTORS_LICENSE = MIT
THINGINO_MOTORS_LICENSE_FILES = LICENSE

THINGINO_MOTORS_DEPENDENCIES += thingino-jct

# --- WebSocket control path (BR2_PACKAGE_THINGINO_MOTORS_WS) -----------------
#
# This .mk compiles the daemon's sources directly with $(TARGET_CC) rather
# than invoking upstream's own Makefile, so the file list lives here and has
# to be extended here too. Kept as two variables rather than a second
# BUILD_CMDS body so the compile command itself stays a single line that is
# identical in both configurations - the only difference between a WS build
# and a plain one is what is appended below.
#
# $(@D) is only meaningful inside a recipe, so these must stay recursively
# expanded (=/+=, never :=).
THINGINO_MOTORS_DAEMON_SRCS = $(@D)/src/motor-daemon.c
THINGINO_MOTORS_DAEMON_LIBS = -ljct -lm
THINGINO_MOTORS_DAEMON_DEFS =

ifeq ($(BR2_PACKAGE_THINGINO_MOTORS_WS),y)
# sha1/sha256/ws are generic protocol code, ws_token is the credential store,
# motor-ws is the listener and the JSON command protocol. -lpthread is new:
# the daemon already spawned async move workers, but the WS frontend adds a
# listener thread plus one thread per client and links pthread_attr_* on top
# of pthread_create, so the implicit link that carried the old code is no
# longer something to rely on.
THINGINO_MOTORS_DAEMON_SRCS += \
	$(@D)/src/sha1.c \
	$(@D)/src/sha256.c \
	$(@D)/src/ws.c \
	$(@D)/src/ws_token.c \
	$(@D)/src/motor-ws.c
THINGINO_MOTORS_DAEMON_LIBS += -lpthread
# motor-daemon.c guards its listener startup with #ifdef MOTORS_WS. Without
# this define the five files above would still be compiled and linked, and
# the listener would simply never be started - a build that looks entirely
# successful and silently has no WebSocket. Without the guard on the other
# side, a non-WS build fails to link on motor_ws_start().
THINGINO_MOTORS_DAEMON_DEFS += -DMOTORS_WS

# Two things the browser needs that a plain build must not ship:
#
#  - json-motor-token.cgi, which hands the page the daemon's per-boot token
#    out of a mode-0640 file it could not otherwise read. Same shape as
#    timps's timps-token.cgi.
#  - the build-time feature flag. thingino-webui's assemble_plugins.py turns
#    each manifest's featureFlags into `cfg.device["<flag>"] = <bool>` in the
#    generated /var/www/a/plugins.js, which is how every other tag-gated
#    WebUI behaviour in this tree reaches the browser. featureFlags values
#    are literals in a static JSON file, so the Kconfig answer is stamped
#    into the INSTALLED copy here. Editing the installed copy rather than
#    keeping a second manifest file is deliberate: two near-identical
#    manifests would drift, and there is nothing in this tree that templates
#    www assets at install time to borrow instead.
define THINGINO_MOTORS_INSTALL_WS_CMDS
	$(INSTALL) -D -m 0755 $(THINGINO_MOTORS_PKGDIR)/files/www/x/json-motor-token.cgi \
		$(TARGET_DIR)/var/www/x/json-motor-token.cgi

	$(SED) 's/"motorsWs": false/"motorsWs": true/' \
		$(TARGET_DIR)/var/www/a/plugins/motors.webui.json
	grep -q '"motorsWs": true' $(TARGET_DIR)/var/www/a/plugins/motors.webui.json
endef
endif

define THINGINO_MOTORS_INSTALL_JSON_CMDS
	# Stage defaults for later merge by thingino-core
	$(INSTALL) -D -m 0644 $(THINGINO_MOTORS_PKGDIR)/files/motors.json \
		$(TARGET_DIR)/usr/share/thingino-defaults/30-motors.json
endef

ifeq ($(BR2_PACKAGE_THINGINO_MOTORS_DW9714_ONLY),y)
define THINGINO_MOTORS_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(THINGINO_MOTORS_PKGDIR)/files/dw9714-ctrl \
		$(TARGET_DIR)/usr/sbin/dw9714-ctrl

	$(THINGINO_MOTORS_INSTALL_JSON_CMDS)
endef
else

ifeq ($(BR2_PACKAGE_THINGINO_WEBUI),y)
# Web pages must be installed after thingino-webui so that the
# plugin assembly finalize hook discovers the motors manifest.
THINGINO_MOTORS_DEPENDENCIES += thingino-webui

define THINGINO_MOTORS_INSTALL_WWW_CMDS
	$(INSTALL) -d $(TARGET_DIR)/var/www/a
	$(INSTALL) -d $(TARGET_DIR)/var/www/x
	$(INSTALL) -d $(TARGET_DIR)/var/www/a/plugins
	$(INSTALL) -D -m 0644 $(THINGINO_MOTORS_PKGDIR)/files/www/config-motors.html \
		$(TARGET_DIR)/var/www/config-motors.html
	$(INSTALL) -D -m 0644 $(THINGINO_MOTORS_PKGDIR)/files/www/a/config-motors.js \
		$(TARGET_DIR)/var/www/a/config-motors.js
	$(INSTALL) -D -m 0644 $(THINGINO_MOTORS_PKGDIR)/files/www/a/preview-motors.js \
		$(TARGET_DIR)/var/www/a/preview-motors.js
	$(INSTALL) -D -m 0644 $(THINGINO_MOTORS_PKGDIR)/files/www/a/preview-motors.css \
		$(TARGET_DIR)/var/www/a/preview-motors.css
	$(INSTALL) -D -m 0755 $(THINGINO_MOTORS_PKGDIR)/files/www/x/json-motor.cgi \
		$(TARGET_DIR)/var/www/x/json-motor.cgi
	$(INSTALL) -D -m 0755 $(THINGINO_MOTORS_PKGDIR)/files/www/x/json-motor-params.cgi \
		$(TARGET_DIR)/var/www/x/json-motor-params.cgi
	$(INSTALL) -D -m 0755 $(THINGINO_MOTORS_PKGDIR)/files/www/x/json-motors-config.cgi \
		$(TARGET_DIR)/var/www/x/json-motors-config.cgi

	# Install plugin manifest for build-time assembly by thingino-webui
	$(INSTALL) -D -m 0644 $(THINGINO_MOTORS_PKGDIR)/files/motors.webui.json \
		$(TARGET_DIR)/var/www/a/plugins/motors.webui.json

	$(THINGINO_MOTORS_INSTALL_WS_CMDS)
endef

# json-motor-stream.cgi is gone: a fake-SSE endpoint that re-ran `motors -j`
# once a second forever, with no EventSource anywhere in the tree consuming
# it. Dropping its install rule is not enough on its own - $(TARGET_DIR) is
# never pruned, so an output tree built before this change keeps the old copy
# and keeps serving it.
#
# It has to be a TARGET_FINALIZE hook rather than an rm in the install
# commands above. Under PER_PACKAGE_DIRECTORIES, $(TARGET_DIR) inside a
# package recipe is that package's OWN target copy; deleting the file there
# does nothing to the shared tree, which target-finalize then assembles by
# merging the per-package copies over whatever is already present (no
# --delete). Verified empirically: the rm ran, reported success against the
# per-package path, and the stale file was still in target/var/www/x
# afterwards. Same lesson timps documents for its stock-WebUI purge.
define THINGINO_MOTORS_PURGE_DEAD_WWW
	rm -f $(TARGET_DIR)/var/www/x/json-motor-stream.cgi
endef
TARGET_FINALIZE_HOOKS += THINGINO_MOTORS_PURGE_DEAD_WWW
endif

# -ffunction-sections/-fdata-sections (compile) + --gc-sections (link): lets
# the linker drop dead code per-function instead of per-object-file. Measured
# on the real production command line, WS build: 62904 -> 55224 bytes
# (-7680 B, -12.2%) - the .pdr/.reginfo MIPS debug-metadata sections (unused
# on this Linux target) disappear entirely, plus four already-orphaned dead
# functions left over from the switch-case extraction refactor become
# link-time removable for the first time (they were unremovable before this
# flag because without per-function sections the whole .o was one
# indivisible blob). Verified: both marker strings ("nested too deeply",
# "keepalive timeout") and every WS/auth symbol survive; ws_selftest's 48
# assertions pass unchanged before and after.
define THINGINO_MOTORS_BUILD_CMDS
	$(TARGET_CC) $(TARGET_LDFLAGS) -Os -s -ffunction-sections -fdata-sections $(@D)/src/motor.c -o $(@D)/motors -ljct -Wl,--gc-sections
	$(TARGET_CC) $(TARGET_LDFLAGS) -Os -s -ffunction-sections -fdata-sections $(THINGINO_MOTORS_DAEMON_DEFS) $(THINGINO_MOTORS_DAEMON_SRCS) -o $(@D)/motors-daemon $(THINGINO_MOTORS_DAEMON_LIBS) -Wl,--gc-sections
endef

define THINGINO_MOTORS_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0755 $(@D)/motors \
		$(TARGET_DIR)/usr/bin/motors

	$(INSTALL) -D -m 0755 $(@D)/motors-daemon \
		$(TARGET_DIR)/usr/bin/motors-daemon

	$(INSTALL) -D -m 0755 $(THINGINO_MOTORS_PKGDIR)/files/S59motor \
		$(TARGET_DIR)/etc/init.d/S59motor

	$(INSTALL) -D -m 0755 $(THINGINO_MOTORS_PKGDIR)/files/ptz_presets \
		$(TARGET_DIR)/usr/sbin

	$(INSTALL) -D -m 0755 $(THINGINO_MOTORS_PKGDIR)/files/ptz-ctrl \
		$(TARGET_DIR)/usr/sbin/ptz-ctrl

	$(INSTALL) -D -m 0644 $(THINGINO_MOTORS_PKGDIR)/files/ptz_presets.conf \
		$(TARGET_DIR)/etc/ptz_presets.conf

	$(THINGINO_MOTORS_INSTALL_JSON_CMDS)

	$(THINGINO_MOTORS_INSTALL_WWW_CMDS)
endef
endif

$(eval $(generic-package))
