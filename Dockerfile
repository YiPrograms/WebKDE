# syntax=docker/dockerfile:1
ARG SELKIES_BASE_IMAGE=ghcr.io/linuxserver/baseimage-selkies:debiantrixie@sha256:ac7fd6d182238b4a99e66554c5e75be48a714e2a0c9da81bd18e171ff9ba3dd5
FROM ${SELKIES_BASE_IMAGE}

ARG MONITOR_WIDTH=1920
ARG MONITOR_HEIGHT=1080

LABEL org.opencontainers.image.title="WebKDE Selkies bridge" \
      org.opencontainers.image.description="Selkies/Pixelflux and Labwc container for a host-native nested KDE Plasma session"

COPY --chmod=0755 container/defaults/startwm_wayland.sh /defaults/startwm_wayland.sh
COPY --chmod=0644 container/defaults/labwc.xml /defaults/labwc.xml
COPY --chmod=0755 container/patches/selkies-empty-file-transfers.py /tmp/selkies-empty-file-transfers.py
COPY --chmod=0755 container/entrypoint.sh /webkde-entrypoint.sh
RUN case "${MONITOR_WIDTH}:${MONITOR_HEIGHT}" in \
      *[!0-9:]*|:*|*:) echo "Monitor dimensions must be integers" >&2; exit 1 ;; \
    esac \
    && sed -i \
      -e "s/@MONITOR_WIDTH@/${MONITOR_WIDTH}/g" \
      -e "s/@MONITOR_HEIGHT@/${MONITOR_HEIGHT}/g" \
      /defaults/labwc.xml \
    && /lsiopy/bin/python3 /tmp/selkies-empty-file-transfers.py \
    && rm /tmp/selkies-empty-file-transfers.py

HEALTHCHECK --interval=20s --timeout=5s --start-period=45s --retries=5 \
  CMD curl --insecure --fail --silent --show-error \
    --user "${CUSTOM_USER}:${PASSWORD}" https://127.0.0.1:3001/ >/dev/null || exit 1

EXPOSE 3001
VOLUME ["/config"]
ENTRYPOINT ["/webkde-entrypoint.sh"]
