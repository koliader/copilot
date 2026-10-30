import unittest
from types import SimpleNamespace
from recognizer import KeyRecognizer

class RecognitionTests(unittest.TestCase):
    def setUp(self):
        self.events = []
        self.r = KeyRecognizer(SimpleNamespace(send='ctrl', settings='ctrl+alt+s', copy='', toggle='ctrl+alt+x', quit='ctrl+alt+u'), self.events.append)

    def chord(self, keys):
        for i, key in enumerate(keys): self.r.feed(key, True, i / 10)
        for i, key in enumerate(reversed(keys)): self.r.feed(key, False, 1 + i / 10)

    def test_ctrl_only_after_release(self):
        self.r.feed('ctrl', True, 0)
        self.r.feed('ctrl', True, .1)
        self.assertEqual(self.events, [])
        self.r.feed('ctrl', False, .2)
        self.assertEqual([e.kind for e in self.events], ['send'])

    def test_shortcuts_never_send(self):
        for keys in [('ctrl', 'c'), ('ctrl', 'v'), ('ctrl', 'a'), ('ctrl', 'z'), ('ctrl', 'shift'), ('ctrl', 'alt')]: self.chord(keys)
        self.assertEqual(self.events, [])

    def test_disable_keeps_quit(self):
        self.chord(('ctrl', 'alt', 'x'))
        self.chord(('ctrl',))
        self.chord(('ctrl', 'alt', 'u'))
        self.assertEqual([e.kind for e in self.events], ['hotkeys_toggled', 'quit'])

    def test_double_escape(self):
        self.r.feed('esc', True, 0); self.r.feed('esc', False, .05)
        self.r.feed('esc', True, .3); self.r.feed('esc', False, .35)
        self.assertEqual([e.kind for e in self.events], ['hide', 'cancel'])

if __name__ == '__main__': unittest.main()
