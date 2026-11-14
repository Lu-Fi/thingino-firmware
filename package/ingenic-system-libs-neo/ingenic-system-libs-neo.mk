################################################################################
#
# ingenic-system-libs-neo
#
################################################################################

INGENIC_SYSTEM_LIBS_NEO_SITE_METHOD = git
INGENIC_SYSTEM_LIBS_NEO_SITE = https://github.com/Lu-Fi/ingenic-system-libs-neo
INGENIC_SYSTEM_LIBS_NEO_SITE_BRANCH = aperto
INGENIC_SYSTEM_LIBS_NEO_VERSION = 518648df6a66959cd76218cc28735deee1a01c02
INGENIC_SYSTEM_LIBS_NEO_INSTALL_STAGING = YES

# Upstream documents the project as MIT but does not currently ship a
# top-level license file for legal-info to collect.
INGENIC_SYSTEM_LIBS_NEO_LICENSE = MIT

ifeq ($(BR2_PACKAGE_INGENIC_LIB),y)
INGENIC_SYSTEM_LIBS_NEO_DEPENDENCIES += ingenic-lib
endif

define INGENIC_SYSTEM_LIBS_NEO_BUILD_CMDS
	$(TARGET_MAKE_ENV) $(MAKE) -C $(@D) CROSS_COMPILE=$(TARGET_CROSS)
	$(TARGET_MAKE_ENV) $(MAKE) -C $(@D) strip CROSS_COMPILE=$(TARGET_CROSS)
endef

define INGENIC_SYSTEM_LIBS_NEO_INSTALL_STAGING_CMDS
	$(TARGET_MAKE_ENV) $(MAKE) -C $(@D) install-staging \
		DESTDIR=$(STAGING_DIR) CROSS_COMPILE=$(TARGET_CROSS)
endef

define INGENIC_SYSTEM_LIBS_NEO_INSTALL_TARGET_CMDS
	$(if $(BR2_PACKAGE_INGENIC_SYSTEM_LIBS_NEO_LIBALOG),
		$(INSTALL) -D -m 0755 $(@D)/libalog.so $(TARGET_DIR)/usr/lib/libalog.so
	)
	$(if $(BR2_PACKAGE_INGENIC_SYSTEM_LIBS_NEO_LIBSYSUTILS),
		$(INSTALL) -D -m 0755 $(@D)/libsysutils.so $(TARGET_DIR)/usr/lib/libsysutils.so
	)
endef

define INGENIC_SYSTEM_LIBS_NEO_FINALIZE_TARGET
	$(if $(BR2_PACKAGE_INGENIC_SYSTEM_LIBS_NEO_LIBALOG),
		$(INSTALL) -m 0755 $(BUILD_DIR)/ingenic-system-libs-neo-$(INGENIC_SYSTEM_LIBS_NEO_VERSION)/libalog.so \
			$(TARGET_DIR)/usr/lib/libalog.so
	)
	$(if $(BR2_PACKAGE_INGENIC_SYSTEM_LIBS_NEO_LIBSYSUTILS),
		$(INSTALL) -m 0755 $(BUILD_DIR)/ingenic-system-libs-neo-$(INGENIC_SYSTEM_LIBS_NEO_VERSION)/libsysutils.so \
			$(TARGET_DIR)/usr/lib/libsysutils.so
	)
endef
INGENIC_SYSTEM_LIBS_NEO_TARGET_FINALIZE_HOOKS += INGENIC_SYSTEM_LIBS_NEO_FINALIZE_TARGET

$(eval $(generic-package))
