#!/usr/bin/env python3
"""
Minimal PTY bridge used when node-pty is unavailable.

Allocates a pseudo terminal, runs an interactive shell on it and copies bytes
between the pty and stdio. This gives the browser terminal a real prompt, echo,
colors and job control even without a native addon.

Usage: pty-helper.py [cols] [rows]
"""

import os
import pty
import select
import struct
import sys
import termios
import fcntl

cols = int(sys.argv[1]) if len(sys.argv) > 1 else 80
rows = int(sys.argv[2]) if len(sys.argv) > 2 else 24
shell = os.environ.get("SHELL") or "/bin/bash"

pid, master = pty.fork()
if pid == 0:  # child
    os.environ["TERM"] = "xterm-256color"
    try:
        os.execlp(shell, shell, "-i")
    except OSError:
        os.execlp("/bin/sh", "sh", "-i")
    os._exit(127)

try:
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
except OSError:
    pass

stdin_fd = sys.stdin.fileno()
stdout_fd = sys.stdout.fileno()

try:
    while True:
        readable, _, _ = select.select([master, stdin_fd], [], [])
        if master in readable:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            os.write(stdout_fd, data)
        if stdin_fd in readable:
            try:
                data = os.read(stdin_fd, 65536)
            except OSError:
                break
            if not data:
                break
            os.write(master, data)
finally:
    try:
        os.close(master)
    except OSError:
        pass
    try:
        os.waitpid(pid, 0)
    except OSError:
        pass
