#!/usr/bin/env python3
# BSD 3-Clause License
# Copyright (c) 2026, Xnerv Wang
# All rights reserved.

"""Prints the title of the X11 window that has the input focus, for ui.js on Linux.

Under xvfb-run there is no window manager, so VS Code reports every window it has focused once as focused for good, and
Playwright makes every page report focus. The X server still knows which window has the input focus: Electron gives it
to the window it brings to the front. The focus can sit on a child window, so the title is looked for up the tree.

Prints nothing, and exits 1, when there is no display or no titled window has the focus.
"""

import ctypes
import ctypes.util
import sys


def main():
    lib = ctypes.util.find_library("X11")
    if not lib:
        return 1
    x = ctypes.cdll.LoadLibrary(lib)
    x.XOpenDisplay.restype = ctypes.c_void_p
    x.XOpenDisplay.argtypes = [ctypes.c_char_p]
    x.XGetInputFocus.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_int)]
    x.XInternAtom.restype = ctypes.c_ulong
    x.XInternAtom.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int]
    x.XGetWindowProperty.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong, ctypes.c_long, ctypes.c_long,
                                     ctypes.c_int, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong),
                                     ctypes.POINTER(ctypes.c_int), ctypes.POINTER(ctypes.c_ulong),
                                     ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_void_p)]
    x.XQueryTree.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong),
                             ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_void_p),
                             ctypes.POINTER(ctypes.c_uint)]
    x.XFree.argtypes = [ctypes.c_void_p]
    display = x.XOpenDisplay(None)
    if not display:
        return 1
    win, revert = ctypes.c_ulong(), ctypes.c_int()
    x.XGetInputFocus(display, ctypes.byref(win), ctypes.byref(revert))
    name_atom = x.XInternAtom(display, b"_NET_WM_NAME", 0)
    wm_name = x.XInternAtom(display, b"WM_NAME", 0)
    w = win.value
    for _ in range(64):
        if w in (0, 1):  # None, PointerRoot
            break
        for atom in (name_atom, wm_name):
            kind, fmt, count, after, data = ctypes.c_ulong(), ctypes.c_int(), ctypes.c_ulong(), ctypes.c_ulong(), ctypes.c_void_p()
            # AnyPropertyType is 0.
            if x.XGetWindowProperty(display, w, atom, 0, 4096, 0, 0, ctypes.byref(kind), ctypes.byref(fmt), ctypes.byref(count),
                                    ctypes.byref(after), ctypes.byref(data)) == 0 and data.value and count.value:
                text = ctypes.string_at(data.value, count.value).decode("utf-8", "replace")
                x.XFree(data)
                if text:
                    print(text)
                    return 0
        root, parent, children, n = ctypes.c_ulong(), ctypes.c_ulong(), ctypes.c_void_p(), ctypes.c_uint()
        if not x.XQueryTree(display, w, ctypes.byref(root), ctypes.byref(parent), ctypes.byref(children), ctypes.byref(n)):
            break
        if children.value:
            x.XFree(children)
        if parent.value == root.value or parent.value == 0:
            break
        w = parent.value
    return 1


if __name__ == "__main__":
    sys.exit(main())
