"""Bounded UIA reader with verified Ctrl+C fallback; no GUI dependency."""

import asyncio
import ctypes
import logging
import queue
import threading
import time


class SelectionReader:
    def __init__(self, api, hotkeys):
        self.api, self.hotkeys = api, hotkeys
        self.uia_lock = threading.Lock()
        self.reader_lock = threading.Lock()
        self.copy_in_progress = hotkeys.copy_in_progress

    async def read_async(self, source):
        if not self.reader_lock.acquire(blocking=False):
            raise ValueError("Предыдущее чтение выделения ещё завершается. Повторите запрос.")
        result = queue.Queue()

        def worker():
            try:
                result.put(self.read(source))
            except Exception:
                result.put("")
            finally:
                self.reader_lock.release()

        threading.Thread(target=worker, name="selection", daemon=True).start()
        while True:
            try:
                return result.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.02)

    def _copy_keyboard_shortcut(self):
        send_key = self.api.user32.keybd_event
        send_key.argtypes = [
            ctypes.c_ubyte,
            ctypes.c_ubyte,
            ctypes.c_ulong,
            ctypes.c_size_t,
        ]
        send_key.restype = None

        # Нажатие Ctrl и C по конкретным кодам Windows
        send_key(0x11, 0x1D, 0, 0)
        try:
            send_key(0x43, 0x2E, 0, 0)
        finally:
            send_key(0x43, 0x2E, 0x0002, 0)
            send_key(0x11, 0x1D, 0x0002, 0)

    def _clipboard_selected_text(self, source_hwnd):
        import keyboard
        import pyperclip

        """Read only a NEW copy operation; never send old clipboard contents.

        The copied selection remains in the clipboard, just like ordinary Ctrl+C.
        No clipboard clearing or text-only restoration that would destroy images/HTML.
        """
        self.copy_in_progress.set()
        try:
            deadline = time.monotonic() + 0.8
            while any(keyboard.is_pressed(k) for k in ("ctrl", "alt", "shift", "windows")):
                if time.monotonic() >= deadline:
                    return ""
                time.sleep(0.02)
            if self.api.user32.GetForegroundWindow() != source_hwnd:
                return ""
            before = self.api.user32.GetClipboardSequenceNumber()
            if not before:
                return ""
            self._copy_keyboard_shortcut()
            deadline = time.monotonic() + 1.5
            while time.monotonic() < deadline:
                if self.api.user32.GetForegroundWindow() != source_hwnd:
                    return ""
                try:
                    # Reading also forces delayed rendering before checking the sequence.
                    reading_sequence = self.api.user32.GetClipboardSequenceNumber()
                    value = pyperclip.paste()
                    after = self.api.user32.GetClipboardSequenceNumber()
                    if after and after == reading_sequence and after != before and value and value.strip():
                        if self.api.user32.GetForegroundWindow() == source_hwnd:
                            return value.strip()
                        return ""
                except Exception:
                    pass  # Another application may briefly hold OpenClipboard.
                time.sleep(0.025)
            return ""
        finally:
            self.hotkeys.ignore_until = time.monotonic() + 0.25
            self.copy_in_progress.clear()

    def _uia_read_selection(self):
        """Получить выделение через Windows UI Automation, не нажимая Ctrl+C.

        Работает только в программах, которые предоставляют TextPattern.
        Буфер обмена не используется и не меняется.
        """
        try:
            import comtypes
            import comtypes.client

            try:
                from comtypes.gen import UIAutomationClient as UIA
            except ImportError:
                comtypes.client.GetModule("UIAutomationCore.dll")
                from comtypes.gen import UIAutomationClient as UIA

            comtypes.CoInitialize()
            try:
                # CUIAutomation не имеет надёжного ProgID на всех версиях Windows.
                # Используем официальный CLSID вместо строки имени класса.
                automation = comtypes.client.CreateObject(
                    comtypes.GUID("{FF48DBA4-60EF-4201-AA87-54103EEF594E}"),
                    interface=UIA.IUIAutomation,
                )
                element = automation.GetFocusedElement()
                if element is None:
                    return ""
                if element.CurrentIsPassword:
                    return "__PROTECTED_FIELD__"
                pattern = element.GetCurrentPattern(UIA.UIA_TextPatternId)
                if not pattern:
                    return ""
                text_pattern = pattern.QueryInterface(UIA.IUIAutomationTextPattern)
                ranges = text_pattern.GetSelection()
                pieces = []
                for i in range(ranges.Length):
                    selected = ranges.GetElement(i).GetText(-1)
                    if selected and selected.strip():
                        pieces.append(selected)
                return "\n".join(pieces).strip()
            finally:
                comtypes.CoUninitialize()
        except Exception as exc:
            logging.getLogger(__name__).debug("UIA unavailable: %s", type(exc).__name__)
            return ""

    def _uia_selected_text(self):
        # Some third-party UIA providers hang. A timeout allows the copy fallback;
        # a lock ensures at most one outstanding UIA reader, even if it stays hung.
        if not self.uia_lock.acquire(blocking=False):
            return ""
        result = queue.Queue(maxsize=1)

        def read():
            try:
                result.put(self._uia_read_selection())
            finally:
                self.uia_lock.release()

        try:
            threading.Thread(target=read, daemon=True).start()
        except Exception:
            self.uia_lock.release()
            raise
        try:
            return result.get(timeout=0.8)
        except queue.Empty:
            return ""

    def read(self, source_hwnd):
        if self.api.user32.GetForegroundWindow() != source_hwnd:
            return ""
        text = self._uia_selected_text()
        if self.api.user32.GetForegroundWindow() != source_hwnd:
            return ""
        if text == "__PROTECTED_FIELD__":
            raise ValueError("protected_field")
        if text:
            return text
        return self._clipboard_selected_text(source_hwnd)
