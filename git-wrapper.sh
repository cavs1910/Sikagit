#!/bin/sh
exec /usr/bin/git -c core.hooksPath=/dev/null -c protocol.ext.allow=never -c protocol.file.allow=never "$@"
