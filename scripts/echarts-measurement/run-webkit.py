#!/usr/bin/env python3
"""Loads a test page in WebKitGTK, the engine of Tauri on Linux, and writes its results.

The window is off-screen. The script needs PyGObject with WebKit2 4.1
(Ubuntu: python3-gi and gir1.2-webkit2-4.1). `measure.mjs` starts this script.

Usage: run-webkit.py <address> <output file>
"""

import json
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

TIMEOUT_SECONDS = 15 * 60

address, out = sys.argv[1], sys.argv[2]
status = {"code": 1}

view = WebKit2.WebView()
# The page writes its progress to the console.
view.get_settings().set_enable_write_console_messages_to_stdout(True)
window = Gtk.OffscreenWindow()
window.set_default_size(1400, 900)
window.add(view)
window.show_all()


def on_results(source, result):
    data = json.loads(source.evaluate_javascript_finish(result).to_string())
    data["webkitgtk"] = "%d.%d.%d" % (
        WebKit2.get_major_version(),
        WebKit2.get_minor_version(),
        WebKit2.get_micro_version(),
    )
    with open(out, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=1)
    status["code"] = 0
    Gtk.main_quit()


def on_title(source, _param):
    if source.get_title() == "DONE":
        source.evaluate_javascript(
            "JSON.stringify(window.__results)", -1, None, None, None, on_results
        )


def on_timeout():
    print("Timeout: the page did not finish.", file=sys.stderr)
    Gtk.main_quit()
    return False


view.connect("notify::title", on_title)
GLib.timeout_add_seconds(TIMEOUT_SECONDS, on_timeout)
view.load_uri(address)
Gtk.main()
sys.exit(status["code"])
