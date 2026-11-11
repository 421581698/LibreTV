#!/bin/sh
set -eu

# Render mounts persistent disks after the image is built, which can replace
# the image's original /data ownership. Fix the mounted volume, then drop
# privileges before starting the collector.
mkdir -p /data
chown -R collector:collector /data
exec gosu collector "$@"
