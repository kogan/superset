#!/bin/bash
set -eu
task_root="$(cd "$(dirname "$0")" && pwd)"
exec /usr/bin/python3 "$task_root/scripts/personal/launch.py" stop
