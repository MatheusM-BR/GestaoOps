"""
YT Downloader Backend — servidor compacto para o GestaoOps.
Baixa vídeos do YouTube via yt-dlp com API REST + CORS.
Gerado automaticamente — não edite; atualize via GestaoOps.
"""

import json as _json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS
import yt_dlp

DOWNLOAD_DIR = Path(tempfile.gettempdir()) / "YT_Downloader_3M" / "downloads"
COOKIES_DIR = Path(tempfile.gettempdir()) / "YT_Downloader_3M" / "cookies"
JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")
STALL_SECONDS = 75

def _find_desktop():
    for c in (Path.home() / "Desktop", Path.home() / "OneDrive" / "Desktop"):
        if c.exists():
            return c
    return Path.home()

DEFAULT_DEST = _find_desktop()

# ffmpeg
def _find_exe(name, patterns):
    found = shutil.which(name)
    if found:
        return str(Path(found).parent)
    import glob
    for p in patterns:
        m = glob.glob(os.path.expandvars(p), recursive=True)
        if m:
            return str(Path(m[0]).parent)
    return None

FFMPEG_DIR = _find_exe("ffmpeg", [
    r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg*\**\bin\ffmpeg.exe",
    r"%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe",
    r"C:\ffmpeg\bin\ffmpeg.exe",
])
if FFMPEG_DIR and FFMPEG_DIR not in os.environ.get("PATH", ""):
    os.environ["PATH"] = FFMPEG_DIR + os.pathsep + os.environ["PATH"]

DENO_DIR = _find_exe("deno", [
    r"%LOCALAPPDATA%\Microsoft\WinGet\Packages\DenoLand.Deno*\**\deno.exe",
    r"%LOCALAPPDATA%\Microsoft\WinGet\Links\deno.exe",
    r"%USERPROFILE%\.deno\bin\deno.exe",
])
if DENO_DIR and DENO_DIR not in os.environ.get("PATH", ""):
    os.environ["PATH"] = DENO_DIR + os.pathsep + os.environ["PATH"]

NODE_DIR = _find_exe("node", [
    r"C:\Program Files\nodejs\node.exe",
    r"%LOCALAPPDATA%\Programs\nodejs\node.exe",
])
if NODE_DIR and NODE_DIR not in os.environ.get("PATH", ""):
    os.environ["PATH"] = NODE_DIR + os.pathsep + os.environ["PATH"]

JS_RUNTIME_OK = bool(shutil.which("deno") or shutil.which("node"))

app = Flask(__name__)
CORS(app)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

jobs = {}

# --- Helpers ---
def hms_to_seconds(v):
    if v is None: return None
    v = str(v).strip()
    if not v: return None
    if ":" in v:
        s = 0.0
        for p in v.split(":"): s = s * 60 + (float(p.strip()) if p.strip() else 0.0)
        return s
    return float(v)

def friendly_error(msg):
    m = str(msg).replace("ERROR:", "").strip()
    low = m.lower()
    if "could not copy" in low and "cookie" in low:
        return "Feche o navegador e tente novamente, ou use cookies.txt."
    if "private video" in low:
        return "Vídeo privado: use autenticação (cookies.txt)."
    if "sign in" in low and "bot" in low:
        return "YouTube pediu verificação anti-bot. Use cookies.txt."
    return m

def _fmt_bytes(n):
    if not n: return "?B"
    for u in ("B", "KiB", "MiB", "GiB"):
        if abs(n) < 1024.0: return f"{n:.2f}{u}"
        n /= 1024.0
    return f"{n:.2f}TiB"

def _fmt_eta(s):
    if s is None or s < 0: return "--:--"
    s = int(s)
    m, sec = divmod(s, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{sec:02d}" if h else f"{m:02d}:{sec:02d}"

def _append_log(job, msg, mx=500):
    lines = job.setdefault("log_lines", [])
    lines.append(msg)
    if len(lines) > mx: del lines[:len(lines)-mx]
    job["log"] = msg

class JobLogger:
    def __init__(self, job): self.job = job
    def debug(self, m):
        if not str(m).startswith("[debug]"): self._s(m)
    def info(self, m): self._s(m)
    def warning(self, m):
        self.job["warning"] = str(m).strip()
        _append_log(self.job, f"[aviso] {m}")
    def error(self, m): self._s(m)
    def _s(self, m):
        m = str(m).strip()
        if m and not m.startswith("[debug]"):
            _append_log(self.job, m)

def make_progress_hook(jid):
    def hook(d):
        job = jobs.get(jid)
        if not job: return
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            dl = d.get("downloaded_bytes", 0)
            job["status"] = "downloading"
            job["progress"] = round(dl / total * 100, 1) if total else 0
            job["speed"] = d.get("speed")
            job["eta"] = d.get("eta")
            now = time.time()
            if now - job.get("_lpl", 0) >= 1.0:
                job["_lpl"] = now
                pct = job["progress"]
                sp = f"{_fmt_bytes(d.get('speed'))}/s" if d.get("speed") else "?/s"
                _append_log(job, f"[download] {pct:.1f}% @ {sp}  ETA {_fmt_eta(d.get('eta'))}")
            if dl > job.get("_lb", -1):
                job["_lb"] = dl; job["_lc"] = now
            elif now - job.get("_lc", now) > STALL_SECONDS:
                raise yt_dlp.utils.DownloadError("Download travado (throttling). Atualize o yt-dlp.")
        elif d.get("status") == "finished":
            job["status"] = "processing"
            job["progress"] = 100
            _append_log(job, "[download] 100% — processando…")
    return hook

def make_pp_hook(jid):
    def hook(d):
        job = jobs.get(jid)
        if job and d.get("status") == "started":
            job["status"] = "processing"
            pp = d.get("postprocessor", "")
            if pp: _append_log(job, f"[{pp}] Processando…")
    return hook

def pick_media(outdir, fmt):
    files = [f for f in outdir.iterdir() if f.is_file()]
    if not files: return None
    ext = ".mp3" if fmt == "mp3" else ".mp4"
    exact = [f for f in files if f.suffix.lower() == ext]
    if exact: return max(exact, key=lambda f: f.stat().st_size)
    media = [f for f in files if f.suffix.lower() not in (".part", ".ytdl")]
    return max(media or files, key=lambda f: f.stat().st_size)

def run_download(jid, url, params):
    job = jobs[jid]
    job["status"] = "extracting"
    dest_str = (params.get("dest_path") or "").strip()
    final_dest = Path(dest_str) if dest_str else DEFAULT_DEST
    job.setdefault("log_lines", [])
    _append_log(job, f"Destino: {final_dest}")

    fmt = params.get("format", "mp4")
    quality = params.get("quality", "best")
    outdir = DOWNLOAD_DIR / jid
    outdir.mkdir(parents=True, exist_ok=True)

    try:
        ydl_opts = {
            "outtmpl": str(outdir / "%(title).180B.%(ext)s"),
            "windowsfilenames": True,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "progress_hooks": [make_progress_hook(jid)],
            "postprocessor_hooks": [make_pp_hook(jid)],
            "logger": JobLogger(job),
            "socket_timeout": 30,
            "retries": 5,
            "fragment_retries": 5,
            "concurrent_fragment_downloads": 4,
        }
        if FFMPEG_DIR:
            ydl_opts["ffmpeg_location"] = FFMPEG_DIR

        # Auth
        auth = params.get("auth") or {}
        method = auth.get("method", "none")
        if method == "cookiefile":
            cid = auth.get("cookie_id", "")
            if cid and JOB_ID_RE.match(cid):
                p = COOKIES_DIR / f"{cid}.txt"
                if p.exists(): ydl_opts["cookiefile"] = str(p)
        elif method == "browser":
            ydl_opts["cookiesfrombrowser"] = (auth.get("browser", "chrome").strip().lower(),)
        if method != "none":
            ydl_opts["extractor_args"] = {"youtube": {"player_client": ["tv_embedded"]}}

        # Format
        if fmt == "mp3":
            ydl_opts["format"] = "bestaudio/best"
            ydl_opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": params.get("audio_quality", "192")}]
        else:
            if quality and quality not in ("best", ""):
                h = quality.replace("p", "")
                ydl_opts["format"] = f"bestvideo[height<={h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<={h}]+bestaudio/best[height<={h}]/best"
            else:
                ydl_opts["format"] = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best"
            ydl_opts["merge_output_format"] = "mp4"

        # Trim
        start = hms_to_seconds(params.get("start_time"))
        end = hms_to_seconds(params.get("end_time"))
        if start is not None or end is not None:
            s = start if start is not None else 0.0
            e = end if end is not None else float("inf")
            ydl_opts["download_ranges"] = yt_dlp.utils.download_range_func(None, [(s, e)])
            ydl_opts["force_keyframes_at_cuts"] = True

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            job["title"] = info.get("title")

        media = pick_media(outdir, fmt)
        if not media:
            raise RuntimeError("Nenhum arquivo foi gerado.")

        # Move to final dest
        _append_log(job, f"Movendo para {final_dest}…")
        try:
            final_dest.mkdir(parents=True, exist_ok=True)
            target = final_dest / media.name
            if target.exists():
                stem, suffix = media.stem, media.suffix
                i = 1
                while target.exists():
                    target = final_dest / f"{stem} ({i}){suffix}"
                    i += 1
            shutil.move(str(media), str(target))
            media = target
        except Exception as e:
            job["warning"] = f"Não moveu para '{final_dest}': {e} — arquivo em: {media}"

        job["filename"] = media.name
        job["filepath"] = str(media)
        job["filesize"] = media.stat().st_size
        _append_log(job, f"Salvo em: {media}")
        job["status"] = "done"
        job["progress"] = 100
    except Exception as exc:
        job["status"] = "error"
        job["error"] = friendly_error(exc)
    finally:
        try:
            if outdir.exists():
                fp = job.get("filepath")
                if not fp or Path(fp).parent.resolve() != outdir.resolve():
                    shutil.rmtree(outdir, ignore_errors=True)
        except: pass

# --- Routes ---
@app.route("/")
def index():
    return jsonify({"status": "ok", "ytdlp": getattr(yt_dlp.version, "__version__", "?"), "ffmpeg": bool(FFMPEG_DIR), "js_runtime": JS_RUNTIME_OK})

@app.route("/api/check-update")
def api_check_update():
    return jsonify({"current": getattr(yt_dlp.version, "__version__", "?")})

@app.route("/api/info", methods=["POST"])
def api_info():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url: return jsonify({"error": "Informe a URL."}), 400
    opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "skip_download": True, "socket_timeout": 30}
    if FFMPEG_DIR: opts["ffmpeg_location"] = FFMPEG_DIR
    auth = data.get("auth") or {}
    if auth.get("method") == "cookiefile":
        cid = auth.get("cookie_id", "")
        if cid and JOB_ID_RE.match(cid):
            p = COOKIES_DIR / f"{cid}.txt"
            if p.exists(): opts["cookiefile"] = str(p)
    elif auth.get("method") == "browser":
        opts["cookiesfrombrowser"] = (auth.get("browser", "chrome").strip().lower(),)
    if auth.get("method", "none") != "none":
        opts["extractor_args"] = {"youtube": {"player_client": ["tv_embedded"]}}
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        return jsonify({"error": friendly_error(e)}), 400
    heights = sorted({f.get("height") for f in info.get("formats", []) if f.get("height") and f.get("vcodec") not in (None, "none")}, reverse=True)
    return jsonify({
        "id": info.get("id"), "title": info.get("title"),
        "uploader": info.get("uploader") or info.get("channel"),
        "duration": info.get("duration"), "duration_string": info.get("duration_string"),
        "thumbnail": info.get("thumbnail"), "is_live": info.get("is_live"),
        "availability": info.get("availability"), "heights": heights,
    })

@app.route("/api/upload-cookies", methods=["POST"])
def api_upload_cookies():
    f = request.files.get("cookies")
    if not f or f.filename == "": return jsonify({"error": "Nenhum arquivo."}), 400
    cid = uuid.uuid4().hex
    COOKIES_DIR.mkdir(parents=True, exist_ok=True)
    f.save(str(COOKIES_DIR / f"{cid}.txt"))
    return jsonify({"cookie_id": cid})

@app.route("/api/download", methods=["POST"])
def api_download():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url: return jsonify({"error": "Informe a URL."}), 400
    fmt = data.get("format", "mp4")
    if (fmt == "mp3" or data.get("start_time") or data.get("end_time")) and not FFMPEG_DIR:
        return jsonify({"error": "ffmpeg necessário para MP3/corte. Instale: winget install Gyan.FFmpeg"}), 400
    jid = uuid.uuid4().hex
    jobs[jid] = {"status": "queued", "progress": 0, "title": None, "error": None, "filename": None, "log_lines": [], "log": ""}
    params = {k: data.get(k) for k in ("format", "quality", "audio_quality", "start_time", "end_time", "auth", "dest_path")}
    params.setdefault("format", "mp4")
    params.setdefault("quality", "best")
    params.setdefault("audio_quality", "192")
    threading.Thread(target=run_download, args=(jid, url, params), daemon=True).start()
    return jsonify({"job_id": jid})

@app.route("/api/progress/<jid>")
def api_progress(jid):
    job = jobs.get(jid)
    if not job: return jsonify({"error": "Job não encontrado."}), 404
    return jsonify({k: job.get(k) for k in ("status", "progress", "speed", "eta", "title", "filename", "filepath", "filesize", "error", "log", "log_lines", "warning")})

@app.route("/api/file/<jid>")
def api_file(jid):
    if not JOB_ID_RE.match(jid): return jsonify({"error": "ID inválido."}), 400
    job = jobs.get(jid)
    if not job or job.get("status") != "done" or not job.get("filepath"):
        return jsonify({"error": "Arquivo indisponível."}), 404
    return send_file(job["filepath"], as_attachment=True, download_name=job["filename"])

@app.route("/api/open-folder/<jid>")
def api_open_folder(jid):
    if not JOB_ID_RE.match(jid): return jsonify({"error": "ID inválido."}), 400
    job = jobs.get(jid)
    if not job or not job.get("filepath"): return jsonify({"error": "Não encontrado."}), 404
    try: subprocess.Popen(["explorer", str(Path(job["filepath"]).parent)])
    except: pass
    return jsonify({"ok": True})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("=" * 50)
    print("  YT Downloader Backend (GestaoOps)")
    print("=" * 50)
    print(f"  yt-dlp  : {getattr(yt_dlp.version, '__version__', '?')}")
    print(f"  ffmpeg  : {FFMPEG_DIR or 'NAO ENCONTRADO'}")
    print(f"  JS      : {DENO_DIR or NODE_DIR or 'NAO ENCONTRADO'}")
    print(f"  Porta   : {port}")
    print(f"  Acesse  : http://localhost:{port}")
    print("=" * 50)
    # Cleanup
    try:
        for sub in DOWNLOAD_DIR.iterdir():
            if sub.is_dir() and JOB_ID_RE.match(sub.name):
                shutil.rmtree(sub, ignore_errors=True)
    except: pass
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)
