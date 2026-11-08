"""Quartz pointer delivery using the current cursor position."""
import atexit
import threading
import ctypes
import sys

class Point(ctypes.Structure):
    _fields_ = [('x', ctypes.c_double), ('y', ctypes.c_double)]

_api = None
_held = False
_lock = threading.RLock()

def api():
    global _api
    if sys.platform != 'darwin':
        raise RuntimeError('Mouse actions are available on macOS only.')
    if _api is None:
        cg = ctypes.CDLL('/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices')
        cg.AXIsProcessTrusted.restype = ctypes.c_bool
        cg.CGEventCreate.argtypes = [ctypes.c_void_p]
        cg.CGEventCreate.restype = ctypes.c_void_p
        cg.CGEventGetLocation.argtypes = [ctypes.c_void_p]
        cg.CGEventGetLocation.restype = Point
        cg.CGEventCreateMouseEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint32, Point, ctypes.c_uint32]
        cg.CGEventCreateMouseEvent.restype = ctypes.c_void_p
        cg.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
        cg.CFRelease.argtypes = [ctypes.c_void_p]
        _api = cg
    if not _api.AXIsProcessTrusted():
        raise RuntimeError('Enable Accessibility for Neural and its Python helper to control the mouse.')
    return _api

def _pointer(dx=0, dy=0, button=None, kinds=None):
    cg = api()
    source = cg.CGEventCreate(None)
    if not source:
        raise RuntimeError('macOS could not read the pointer position.')
    try:
        point = cg.CGEventGetLocation(source)
    finally:
        cg.CFRelease(source)
    point.x += dx
    point.y += dy
    events = []
    try:
        for kind in (kinds if kinds is not None else ([6 if _held else 5] if button is None else [3,4] if button == 'right' else [1,2])):
            event = cg.CGEventCreateMouseEvent(None, kind, point, 1 if button == 'right' else 0)
            if not event:
                raise RuntimeError('macOS could not create a mouse event.')
            events.append(event)
        for event in events:
            cg.CGEventPost(0, event)
    finally:
        for event in events:
            cg.CFRelease(event)


def pointer(dx=0, dy=0, button=None):
    global _held
    with _lock:
        _pointer(dx, dy, button)
        if button == 'left':
            _held = False


def toggle_hold():
    global _held
    with _lock:
        _pointer(button='left', kinds=[2 if _held else 1])
        _held = not _held


def holding():
    return _held


def release_hold():
    global _held
    with _lock:
        if _held:
            _pointer(button='left', kinds=[2])
            _held = False


atexit.register(release_hold)
