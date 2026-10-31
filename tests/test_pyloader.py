"""The page copies a fixed list of Python files into Pyodide (web/pyloader.js). If a module is
added to web/sim/ but not to that list, the page fails to start with an ImportError that the
normal tests cannot see. This test keeps the list and the folder in step."""

import re
from pathlib import Path

WEB = Path(__file__).resolve().parent.parent / "web"


def listed_files():
    text = (WEB / "pyloader.js").read_text()
    block = re.search(r"const PY_FILES = \[(.*?)\];", text, re.S).group(1)
    return set(re.findall(r'"([^"]+\.py)"', block))


def test_every_sim_module_is_loaded_by_the_page():
    on_disk = {p.name for p in (WEB / "sim").glob("*.py")}
    assert listed_files() == on_disk


def imported_modules(path):
    """Sibling modules a file imports: `from . import a, b as c` and `from .a import x`."""
    names = set()
    for line in path.read_text().splitlines():
        m = re.match(r"from \. import (.+)", line)
        if m:
            names |= {part.split(" as ")[0].strip() for part in m.group(1).split(",")}
        m = re.match(r"from \.(\w+) import", line)
        if m:
            names.add(m.group(1))
    return names


def test_every_import_inside_sim_is_a_listed_module():
    listed = {name[:-3] for name in listed_files()}
    for path in (WEB / "sim").glob("*.py"):
        for name in imported_modules(path):
            assert name in listed, f"{path.name} imports {name}, which pyloader.js does not load"


def test_the_import_scanner_finds_what_it_should():
    found = imported_modules(WEB / "sim" / "presets.py") | imported_modules(WEB / "sim" / "api.py")
    assert {"constellation", "geometry", "presets", "dop"} <= found
