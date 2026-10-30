# Selection helper protocol v1

Child stdio uses UTF-8 JSON Lines. No listening socket. Parent sends configure (active, epoch, exclude HWND strings), cancel (epoch), shutdown. Child sends ready (version=1), command (action), selection (epoch, captureId, text), error (epoch, message). Maximum input text: 32000 characters. Parent rejects late epochs. Own windows are excluded. EOF removes the hook. Clipboard fallback retains the newly copied text; old clipboard is never used.

Source of recognizer and selection reader: the local Ollama Overlay modules, adapted for this fork. No runtime dependency on that application.
