#!/usr/bin/env python3
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / ".personal-data"
BUN = ROOT / ".personal-tools/bin/bun"
PID_FILE = DATA / "desktop.pid"
PAGES_PID_FILE = DATA / "pages.pid"
ENV = {
    **os.environ,
    "PATH": f"{ROOT / '.personal-tools/bin'}:/opt/homebrew/bin:/usr/local/bin:{os.environ.get('PATH', '')}",
    "NODE_ENV": "development",
}
ENV.pop("SUPERSET_WORKSPACE_ID", None)


def running_pid():
    try:
        pid = int(PID_FILE.read_text().strip())
    except (FileNotFoundError, ValueError):
        return None
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True
    )
    return pid if str(BUN) in result.stdout and "dev:desktop" in result.stdout else None


def renderer_ready(runtime):
    if runtime.get("workspace") != str(ROOT):
        return False
    try:
        port = int(runtime["debugPort"])
        with urlopen(f"http://127.0.0.1:{port}/json/list", timeout=1) as response:
            targets = json.load(response)
        return any(
            target.get("type") == "page" and
            target.get("url", "").startswith(f"http://localhost:{runtime['rendererPort']}/")
            for target in targets
        )
    except (OSError, URLError, ValueError, KeyError):
        return False


def save_runtime(runtime):
    (DATA / "runtime.json").write_text(json.dumps(runtime, indent=2) + "\n")


def pages_pid():
    try:
        pid = int(PAGES_PID_FILE.read_text().strip())
    except (FileNotFoundError, ValueError):
        return None
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "command="], capture_output=True, text=True
    )
    return pid if str(BUN) in result.stdout and "usercontent/scripts/personal.ts" in result.stdout else None


def read_settings():
    settings = {}
    for line in (ROOT / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            settings[key.strip()] = value.strip().strip('\"\'')
    return settings


def compose_project(settings):
    name = settings.get("SUPERSET_WORKSPACE_NAME", ROOT.name)
    return "superset-" + re.sub(r"[^a-z0-9._-]+", "-", name.lower()).strip("-")[:48]


def start_pages(settings):
    with (DATA / "pages.log").open("a") as log:
        subprocess.run(
            ["docker", "compose", "-p", compose_project(settings), "-f", "docker-compose.yml",
             "-f", "scripts/personal/pages-compose.yml", "up", "-d", "--wait", "pages-storage"],
            cwd=ROOT, env=ENV, stdout=log, stderr=log, check=True,
        )
        if pages_pid():
            return
        child = subprocess.Popen(
            [str(BUN), "--env-file=.env", "apps/usercontent/scripts/personal.ts"],
            cwd=ROOT, env=ENV, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            start_new_session=True,
        )
        PAGES_PID_FILE.write_text(str(child.pid))
    content_url = urlsplit(settings["USERCONTENT_URL"])
    health_request = Request(
        f"http://127.0.0.1:{content_url.port}/health", headers={"Host": content_url.netloc}
    )
    for _ in range(30):
        try:
            with urlopen(health_request, timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, URLError):
            pass
        if child.poll() is not None:
            break
        time.sleep(0.5)
    raise RuntimeError(f"Pages did not start. Check {DATA / 'pages.log'}")


def stop_pages():
    page_process = pages_pid()
    if page_process:
        try:
            os.killpg(page_process, signal.SIGTERM)
        except ProcessLookupError:
            pass
        for _ in range(30):
            if not pages_pid():
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("Pages is still stopping. Try again in a moment.")
    PAGES_PID_FILE.unlink(missing_ok=True)


def stop():
    stop_pages()
    pid = running_pid()
    if pid is None:
        print("superestset is not running.")
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    for _ in range(40):
        try:
            os.killpg(pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.25)
    else:
        raise RuntimeError("The app is still stopping. Try again in a moment.")
    PID_FILE.unlink(missing_ok=True)
    print("superestset stopped.")


def start():
    settings = read_settings()
    if running_pid():
        try:
            runtime = json.loads((DATA / "runtime.json").read_text())
        except (OSError, ValueError):
            runtime = {}
        if runtime.get("workspace") == str(ROOT):
            if renderer_ready(runtime):
                start_pages(settings)
                runtime["hasOpened"] = True
                save_runtime(runtime)
                subprocess.run(["open", str(ROOT / "apps/desktop/node_modules/electron/dist/Electron.app")], check=True)
                print("superestset is already running.")
                return
            if not runtime.get("hasOpened") and time.time() - runtime.get("startedAt", 0) < 120:
                print("superestset is still starting.")
                return
        stop()
    if not BUN.is_file():
        raise RuntimeError("The local Bun runtime is missing.")
    docker = subprocess.run(
        ["docker", "info"], env=ENV, capture_output=True, cwd=ROOT
    )
    if docker.returncode:
        subprocess.run(["open", "-a", "Docker"], check=True)
        for _ in range(30):
            time.sleep(1)
            if subprocess.run(["docker", "info"], env=ENV, capture_output=True).returncode == 0:
                break
        else:
            raise RuntimeError("Start Docker Desktop, then open superestset again.")
    if not (DATA / "setup-complete").is_file():
        raise RuntimeError("Local setup is incomplete. Run .superset/setup.local.sh first.")
    project = compose_project(settings)
    start_pages(settings)
    with (DATA / "desktop.log").open("a") as log:
        subprocess.run(
            ["docker", "compose", "-p", project, "-f", "docker-compose.yml",
             "-f", "scripts/personal/pages-compose.yml", "up", "-d"],
            cwd=ROOT, env=ENV, stdout=log, stderr=log, check=True,
        )
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            debug_port = sock.getsockname()[1]
        child = subprocess.Popen(
            [str(BUN), "run", "dev:desktop"],
            cwd=ROOT,
            env={**ENV, "RENDERER_REMOTE_DEBUG_PORT": str(debug_port)},
            stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            start_new_session=True,
        )
        PID_FILE.write_text(str(child.pid))
        runtime = {
            "pid": child.pid,
            "debugPort": debug_port,
            "workspace": str(ROOT),
            "rendererPort": settings.get("DESKTOP_VITE_PORT"),
            "apiUrl": settings.get("NEXT_PUBLIC_API_URL"),
            "startedAt": time.time(),
            "hasOpened": False,
        }
        save_runtime(runtime)
    print("superestset is starting. The first launch may take a few minutes.", flush=True)
    print(f"Startup log: {DATA / 'desktop.log'}")
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        if renderer_ready(runtime):
            runtime["hasOpened"] = True
            save_runtime(runtime)
            print("superestset opened.")
            return
        if not running_pid():
            raise RuntimeError(f"Startup stopped. Check {DATA / 'desktop.log'}")
        time.sleep(1)


def main():
    DATA.mkdir(exist_ok=True)
    with (DATA / "launcher.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if sys.argv[1:] == ["stop"]:
            stop()
        elif sys.argv[1:] in ([], ["start"]):
            start()
        else:
            raise RuntimeError("Usage: launch.py [start|stop]")


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"superestset: {error}", file=sys.stderr)
        sys.exit(1)
