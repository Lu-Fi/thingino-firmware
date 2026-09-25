#!/bin/sh
# shellcheck disable=SC1091
# Sensor IQ file: GET info, POST raw .bin to install, POST ?reset for the stock one.
# libimp reads /etc/sensor/<sensor>-<soc>.bin at streamer start.

. /var/www/x/auth.sh
require_auth

SENSOR=$(cat /proc/jz/sensor/sensor0/name 2>/dev/null || cat /proc/jz/sensor/name 2>/dev/null || cat /etc/sensor/model 2>/dev/null)
SOC=$(soc -f 2>/dev/null)
NAME="${SENSOR}-${SOC}.bin"
FILE="/etc/sensor/$NAME"
# /etc/sensor may be a symlink (to /usr/share/sensor); the overlay upper and /rom follow the real path
REAL="$(readlink -f /etc/sensor 2>/dev/null || echo /etc/sensor)/$NAME"
UPPER="/overlay$REAL"

reply() {
	printf 'Status: %s\r\nContent-Type: application/json\r\nCache-Control: no-store\r\n\r\n' "$1"
	printf '%s\n' "$2"
	exit 0
}
fail() { reply "$1" "{\"error\":\"$2\"}"; }

info() {
	local size=0 md5="" custom=0 stock=0 free
	[ -f "$FILE" ] && size=$(wc -c <"$FILE") && md5=$(md5sum "$FILE" | cut -d' ' -f1)
	[ -f "$UPPER" ] && custom=1
	[ -f "/rom$REAL" ] && stock=1
	free=$(df -k /overlay 2>/dev/null | awk 'NR==2{print $4}')
	reply "200 OK" "{\"sensor\":\"$SENSOR\",\"soc\":\"$SOC\",\"file\":\"$FILE\",\"size\":${size:-0},\"md5\":\"$md5\",\"custom\":$custom,\"stock\":$stock,\"overlay_free_kb\":${free:-0}}"
}

[ -n "$SENSOR" ] && [ -n "$SOC" ] || fail "412 Precondition Failed" "sensor or SoC unknown"

[ "$REQUEST_METHOD" = "POST" ] || info

case "$QUERY_STRING" in
	*reset*)
		[ -f "$UPPER" ] || info
		[ -f "/rom$REAL" ] || fail "409 Conflict" "no stock file to restore"
		rm -f "$UPPER" && mount -o remount / 2>/dev/null
		info
		;;
esac

LEN=${CONTENT_LENGTH:-0}
case "$LEN" in '' | *[!0-9]*) fail "411 Length Required" "no length" ;; esac
[ "$LEN" -ge 8192 ] && [ "$LEN" -le 2097152 ] || fail "413 Payload Too Large" "size must be 8 KB..2 MB"
FREE=$(df -k /overlay 2>/dev/null | awk 'NR==2{print $4}')
[ $((LEN / 1024 + 64)) -lt "${FREE:-0}" ] || fail "507 Insufficient Storage" "not enough space on the overlay"

TMP=$(mktemp /tmp/iq.XXXXXX) || fail "500 Internal Server Error" "no temp file"
trap 'rm -f "$TMP"' EXIT
head -c "$LEN" >"$TMP"
[ "$(wc -c <"$TMP")" -eq "$LEN" ] || fail "400 Bad Request" "short upload"
# every Ingenic IQ bin starts with its version string, e.g. "2.10"
case "$(head -c 4 "$TMP")" in
	[0-9].[0-9][0-9]) ;;
	*) fail "415 Unsupported Media Type" "not an Ingenic sensor IQ file" ;;
esac

mkdir -p /etc/sensor && cp "$TMP" "$FILE.new" && chmod 644 "$FILE.new" && mv "$FILE.new" "$FILE" && sync || fail "500 Internal Server Error" "write failed"
info
