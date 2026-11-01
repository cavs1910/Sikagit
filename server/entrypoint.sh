#!/bin/sh
# Credential handling belongs to the restricted runtime helper, never a plaintext store.
exec "$@"
