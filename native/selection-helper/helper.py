"""Windows input bridge. Protocol v1, UTF-8 JSON lines on stdio, no network."""
import ctypes
from ctypes import wintypes
import json
import os
import sys
import threading
import time
from types import SimpleNamespace
import keyboard
from recognizer import KeyRecognizer, LETTER_SCAN_CODES
from selection import SelectionReader

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
api = ctypes.WinDLL('user32', use_last_error=True)
api.GetForegroundWindow.restype = wintypes.HWND
api.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
api.GetClipboardSequenceNumber.restype = wintypes.DWORD
out_lock = threading.Lock()
lock = threading.RLock()
active = False
epoch = 0
busy = False
excluded = set()
owner_pid = os.getppid()
state = SimpleNamespace(copy_in_progress=threading.Event(), ignore_until=0.)
reader = SelectionReader(SimpleNamespace(user32=api), state)

def send(**message):
    with out_lock:
        print(json.dumps(message, ensure_ascii=False), flush=True)

def own_window():
    hwnd = api.GetForegroundWindow()
    pid = wintypes.DWORD()
    api.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    return hwnd, str(hwnd) in excluded or pid.value in (os.getpid(), owner_pid)

def capture(token, hwnd):
    global busy
    try:
        text = reader.read(hwnd)
        if len(text) > 32000: raise ValueError('too_large')
        with lock:
            if token == epoch and active:
                send(type='selection', epoch=token, text=text, captureId=str(time.monotonic_ns()))
    except Exception:
        with lock:
            if token == epoch: send(type='error', epoch=token, message='Не удалось прочитать выделение')
    finally:
        busy = False

def command(cmd):
    global epoch, busy
    hwnd, own = own_window()
    if cmd.kind in ('quit', 'hotkeys_toggled'):
        epoch += 1
        send(type='command', action=cmd.kind, value=cmd.value)
    elif own:
        return
    elif cmd.kind == 'send':
        if busy: return
        busy = True
        send(type='command', action='reading')
        threading.Thread(target=capture, args=(epoch, hwnd), daemon=True).start()
    else:
        if cmd.kind == 'cancel': epoch += 1
        send(type='command', action=cmd.kind)

recognizer = KeyRecognizer(SimpleNamespace(send='ctrl', settings='ctrl+alt+s', copy='', toggle='ctrl+alt+x', quit='ctrl+alt+u'), command)

def key(event):
    with lock:
        if not active: return
        if state.copy_in_progress.is_set() or time.monotonic() < state.ignore_until:
            recognizer.reset()
            return
        name = LETTER_SCAN_CODES.get(event.scan_code, event.name)
        recognizer.feed(name, event.event_type == 'down', time.monotonic(), (event.scan_code, event.is_keypad))

hook = keyboard.hook(key)
send(type='ready', version=1)
try:
    for line in sys.stdin:
        if len(line) > 65536: break
        message = json.loads(line)
        with lock:
            if message['type'] == 'shutdown': break
            if message['type'] == 'configure':
                owner_pid = int(message['ownerPid'])
                active = bool(message['active'])
                excluded = set(message.get('exclude', []))
                epoch = message['epoch']
                recognizer.config = SimpleNamespace(**message['hotkeys'], copy='')
                recognizer.reset()
                recognizer.enabled = bool(message['enabled'])
            elif message['type'] == 'cancel':
                epoch = message['epoch']
finally:
    keyboard.unhook(hook)
