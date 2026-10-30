"""Release-based chord recognition, independent of the keyboard hook backend."""

import threading
import time


from types import SimpleNamespace

def Command(kind, value=None):
    return SimpleNamespace(kind=kind, value=value)

# Windows PC scan codes keep letter shortcuts stable across keyboard layouts.
LETTER_SCAN_CODES = dict(zip(
    (16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
     30, 31, 32, 33, 34, 35, 36, 37, 38,
     44, 45, 46, 47, 48, 49, 50),
    "qwertyuiopasdfghjklzxcvbnm",
))


def normalize_key(name):
    name = (name or "").lower()
    for modifier in ("ctrl", "alt", "shift", "windows"):
        if name in (modifier, "left " + modifier, "right " + modifier):
            return modifier
    return "esc" if name == "escape" else name


class KeyRecognizer:
    def __init__(self, config, emit):
        self.config, self.emit = config, emit
        self.down = set()
        self.pressed_keys = {}
        self.peak = set()
        self.last_escape = float("-inf")
        self.recording = False
        self.enabled = True

    def reset(self):
        self.down.clear()
        self.pressed_keys.clear()
        self.peak.clear()

    def feed(self, name, pressed, now, key_id=None):
        key_id = key_id if key_id is not None else name
        name = normalize_key(name)
        if pressed:
            if key_id in self.pressed_keys:
                return
            if not self.down:
                self.peak.clear()
            already_down = name in self.down
            self.pressed_keys[key_id] = name
            self.down.add(name)
            self.peak.update(self.down)
            if name == "esc" and not already_down and self.enabled and not self.recording:
                self.emit(Command("cancel" if now - self.last_escape <= 0.4 else "hide"))
                self.last_escape = float("-inf") if now - self.last_escape <= 0.4 else now
            return
        if key_id not in self.pressed_keys:
            return
        # Release the original key, even if Shift/layout changed its event name.
        name = self.pressed_keys.pop(key_id)
        if name in self.pressed_keys.values():
            return
        self.down.remove(name)
        if self.down:
            return
        chord = frozenset(self.peak)
        self.peak.clear()
        # Recording has priority so assigning quit never closes the editor.
        if self.recording:
            if chord == {"esc"}:
                self.emit(Command("recorded", ""))
            else:
                order = [k for k in ("ctrl", "alt", "shift", "windows") if k in chord]
                order += sorted(chord - set(order))
                self.emit(Command("recorded", "+".join(order)))
            return
        if chord == frozenset(self.config.quit.split("+")):
            self.emit(Command("quit"))
            return
        if chord == frozenset(self.config.toggle.split("+")):
            self.enabled = not self.enabled
            self.recording = False
            self.last_escape = float("-inf")
            self.emit(Command("hotkeys_toggled", "enabled" if self.enabled else "disabled"))
            return
        if not self.enabled:
            return
        for action in ("send", "settings", "copy"):
            value = getattr(self.config, action)
            if value and chord == frozenset(value.split("+")):
                self.emit(Command(action))


