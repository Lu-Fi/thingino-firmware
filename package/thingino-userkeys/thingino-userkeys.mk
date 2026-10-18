THINGINO_USERKEYS_VERSION = 1.0
THINGINO_USERKEYS_SITE_METHOD = local
THINGINO_USERKEYS_SITE = $(THINGINO_USERKEYS_PKGDIR)/src
THINGINO_USERKEYS_MODULE_MAKE_OPTS = KSRC=$(LINUX_DIR)

TARGET_MODULES_PATH = $(TARGET_DIR)/usr/lib/modules/$(KERNEL_VERSION)$(call qstrip,$(LINUX_CONFIG_LOCALVERSION))
define THINGINO_USERKEYS_INSTALL_TARGET_CMDS
	$(INSTALL) -D -m 0644 $(@D)/gpio-userkeys.ko \
		$(TARGET_MODULES_PATH)/extra/gpio-userkeys.ko
endef

$(eval $(kernel-module))
$(eval $(generic-package))

# The ingenic-sdk gpio-userkeys option is 3.10-only, so on kernel 4.4 nothing
# writes /etc/modules.d/05-gpio-userkeys. Generate it from thingino.json once
# the target tree is final (jct comes from the host tools).
define THINGINO_USERKEYS_GENERATE_CONFIG
	if [ -r $(INGENIC_SDK_CAMERA_JSON) ] && [ -x $(HOST_DIR)/bin/jct ]; then \
		cfg=""; \
		for key_code in button_reset:28 chime:2; do \
			key=$${key_code%%:*}; code=$${key_code##*:}; \
			pin=$$($(HOST_DIR)/bin/jct $(INGENIC_SDK_CAMERA_JSON) get gpio.$$key.pin 2>/dev/null); \
			[ -n "$$pin" ] || pin=$$($(HOST_DIR)/bin/jct $(INGENIC_SDK_CAMERA_JSON) get gpio.$$key 2>/dev/null); \
			case "$$pin" in "" | *[!0-9]*) continue ;; esac; \
			cfg="$${cfg:+$$cfg;}$$code,$$pin,1"; \
		done; \
		if [ -n "$$cfg" ]; then \
			$(INSTALL) -m 0755 -d $(TARGET_DIR)/etc/modules.d; \
			echo "gpio-userkeys gpio_config=\"$$cfg\"" > $(TARGET_DIR)/etc/modules.d/05-gpio-userkeys; \
		fi; \
	fi
endef
ifeq ($(BR2_PACKAGE_THINGINO_USERKEYS),y)
TARGET_FINALIZE_HOOKS += THINGINO_USERKEYS_GENERATE_CONFIG
endif
