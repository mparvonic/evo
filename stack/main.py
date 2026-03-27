"""
EVO FastAPI Backend
Slouží jako bridge mezi webovým frontendem a EVO-X2 infrastrukturou.
"""

import os
import json
import uuid
import asyncio
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional
import re

import httpx
import psutil
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="EVO API", version="1.0")

# Git safe.directory — v Docker kontejneru může být owner /data jiný než www uživatel
subprocess.run(["git", "config", "--global", "safe.directory", "*"], capture_output=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Upřesnit na hello.parvonic.cz v produkci
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Konfigurace ---
DATA_DIR      = Path("/data")
PROJECTS_DIR  = DATA_DIR / "projects"
KNOWLEDGE_EVO = DATA_DIR / "knowledge" / "evo"
OPT_LEGAI     = Path("/opt/legai")
OLLAMA_URL    = os.getenv("OLLAMA_URL", "http://host.docker.internal:11434")
PLANNER_MODEL = "deepseek-r1:32b"

QDRANT_URL    = os.getenv("QDRANT_URL", "http://qdrant:6333")
LITELLM_URL   = os.getenv("LITELLM_URL", "http://litellm:4000")
LITELLM_KEY   = os.getenv("LITELLM_KEY", "")
PREFECT_API   = os.getenv("PREFECT_API_URL", "http://prefect-server:4200/api")
LANGFUSE_HOST = os.getenv("LANGFUSE_HOST", "http://langfuse:3000")
LANGFUSE_PK   = os.getenv("LANGFUSE_PUBLIC_KEY", "")
LANGFUSE_SK   = os.getenv("LANGFUSE_SECRET_KEY", "")

# --- Modely ---
class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    projekt: str
    zpravy: list[ChatMessage]

class KnowledgeWrite(BaseModel):
    obsah: str
    commit_msg: str = "update: knowledge base"

# --- Helpers ---
def projekt_path(projekt: str) -> Path:
    p = PROJECTS_DIR / projekt
    if not p.exists():
        raise HTTPException(404, f"Projekt '{projekt}' neexistuje")
    return p

def knowledge_path(projekt: str) -> Path:
    return projekt_path(projekt) / "knowledge"

def conversations_path(projekt: str) -> Path:
    p = projekt_path(projekt) / "conversations"
    p.mkdir(parents=True, exist_ok=True)
    return p

def workspace_path(projekt: str) -> Path:
    return projekt_path(projekt) / "envs" / "proto" / "workspace"

def git_commit(repo: Path, msg: str):
    subprocess.run(["git", "add", "-A"], cwd=repo, capture_output=True)
    subprocess.run(["git", "commit", "-m", msg, "--allow-empty-message"], cwd=repo, capture_output=True)

def nacti_knowledge(projekt: str, max_znaku: int = 6000) -> str:
    sekce = []
    for f in sorted(KNOWLEDGE_EVO.rglob("*.md")):
        try:
            sekce.append(f"### [EVO] {f.stem}\n{f.read_text()[:600]}")
        except Exception:
            pass
    kb = knowledge_path(projekt)
    if kb.exists():
        for f in sorted(kb.rglob("*.md"))[:15]:
            try:
                rel = f.relative_to(kb)
                sekce.append(f"### [{rel.parent}] {f.stem}\n{f.read_text()[:500]}")
            except Exception:
                pass
    obsah = "\n\n".join(sekce)
    return obsah[:max_znaku]

def nacti_historii(projekt: str, max_zprav: int = 10) -> list[dict]:
    soubor = conversations_path(projekt) / "historie.jsonl"
    if not soubor.exists():
        return []
    radky = soubor.read_text().strip().splitlines()
    zpravy = [json.loads(r) for r in radky if r.strip()]
    return zpravy[-max_zprav:]

def uloz_do_historie(projekt: str, role: str, content: str):
    soubor = conversations_path(projekt) / "historie.jsonl"
    zaznam = {"role": role, "content": content, "ts": datetime.now().isoformat()}
    with open(soubor, "a") as f:
        f.write(json.dumps(zaznam, ensure_ascii=False) + "\n")

# --- Endpoints ---

@app.get("/api/system/stats")
async def system_stats():
    # CPU
    cpu_pct = psutil.cpu_percent(interval=0.2)
    cpu_count = psutil.cpu_count()

    # RAM
    mem = psutil.virtual_memory()

    # Disk /data
    try:
        disk = psutil.disk_usage("/data")
        disk_info = {"total": disk.total, "used": disk.used, "pct": disk.percent}
    except Exception:
        disk_info = None

    # Uptime
    uptime_s = int(datetime.now().timestamp() - psutil.boot_time())

    # Ollama – načtené modely + využití VRAM
    ollama_models = []
    ollama_vram_used = 0
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/ps")
            if resp.status_code == 200:
                for m in resp.json().get("models", []):
                    ollama_models.append({
                        "name": m.get("name", ""),
                        "size": m.get("size", 0),
                        "size_vram": m.get("size_vram", 0),
                    })
                    ollama_vram_used += m.get("size_vram", 0)
    except Exception:
        pass

    # GPU přes sysfs (AMD amdgpu, unified memory)
    gpu_info = None
    for card_name in ["card0", "card1"]:
        try:
            base = Path(f"/sys/class/drm/{card_name}/device")
            total = int((base / "mem_info_vram_total").read_text().strip())
            used  = int((base / "mem_info_vram_used").read_text().strip())
            if total > 0:
                gpu_info = {"used": used, "total": total, "pct": round(used / total * 100, 1)}
            break
        except Exception:
            continue

    return {
        "cpu": {"pct": cpu_pct, "cores": cpu_count},
        "ram": {"total": mem.total, "used": mem.used, "pct": mem.percent},
        "disk": disk_info,
        "gpu": gpu_info,
        "ollama_models": ollama_models,
        "ollama_vram_used": ollama_vram_used,
        "uptime_s": uptime_s,
        "ts": datetime.now().isoformat(),
    }

@app.get("/api/health")
def health():
    return {"status": "ok", "ts": datetime.now().isoformat()}

@app.get("/api/projects")
def list_projects():
    if not PROJECTS_DIR.exists():
        return []
    projekty = []
    for p in sorted(PROJECTS_DIR.iterdir()):
        if not p.is_dir():
            continue
        # Zjisti stav
        workspace = p / "envs" / "proto" / "workspace"
        log = workspace / "crew_log.txt"
        ma_log = log.exists()
        knowledge = p / "knowledge"
        kb_soubory = len(list(knowledge.rglob("*.md"))) if knowledge.exists() else 0
        projekty.append({
            "id": p.name,
            "knowledge_files": kb_soubory,
            "has_log": ma_log,
            "log_modified": log.stat().st_mtime if ma_log else None,
        })
    return projekty

@app.get("/api/projects/{projekt}")
def get_project(projekt: str):
    p = projekt_path(projekt)
    workspace = workspace_path(projekt)
    log = workspace / "crew_log.txt"
    knowledge = knowledge_path(projekt)
    return {
        "id": projekt,
        "raw_sources": [d.name for d in (p / "raw").iterdir()] if (p / "raw").exists() else [],
        "knowledge_files": len(list(knowledge.rglob("*.md"))) if knowledge.exists() else 0,
        "workspace_files": [f.name for f in workspace.glob("*.md")] if workspace.exists() else [],
        "has_running_task": log.exists() and (datetime.now().timestamp() - log.stat().st_mtime) < 300,
    }

@app.get("/api/projects/{projekt}/knowledge/tree")
def knowledge_tree(projekt: str):
    kb = knowledge_path(projekt)
    if not kb.exists():
        return []
    tree = []
    for f in sorted(kb.rglob("*.md")):
        rel = f.relative_to(kb)
        tree.append({
            "path": str(rel),
            "kategorie": str(rel.parent),
            "name": f.stem,
            "size": f.stat().st_size,
            "modified": f.stat().st_mtime,
        })
    return tree

@app.get("/api/projects/{projekt}/knowledge/file")
def read_knowledge_file(projekt: str, path: str = Query(...)):
    kb = knowledge_path(projekt)
    soubor = (kb / path).resolve()
    if not str(soubor).startswith(str(kb)):
        raise HTTPException(403, "Přístup odepřen")
    if not soubor.exists():
        raise HTTPException(404, "Soubor nenalezen")
    return {"path": path, "content": soubor.read_text(encoding="utf-8")}

@app.post("/api/projects/{projekt}/knowledge/file")
def write_knowledge_file(projekt: str, path: str = Query(...), body: KnowledgeWrite = ...):
    kb = knowledge_path(projekt)
    soubor = (kb / path).resolve()
    if not str(soubor).startswith(str(kb)):
        raise HTTPException(403, "Přístup odepřen")
    soubor.parent.mkdir(parents=True, exist_ok=True)
    soubor.write_text(body.obsah, encoding="utf-8")
    git_commit(kb, body.commit_msg)
    return {"ok": True, "path": path}

@app.get("/api/projects/{projekt}/knowledge/history")
def knowledge_history(projekt: str):
    kb = knowledge_path(projekt)
    result = subprocess.run(
        ["git", "log", "--oneline", "-20"],
        cwd=kb, capture_output=True, text=True
    )
    commits = []
    for line in result.stdout.strip().splitlines():
        parts = line.split(" ", 1)
        if len(parts) == 2:
            commits.append({"hash": parts[0], "message": parts[1]})
    return commits

@app.get("/api/projects/{projekt}/tasks/log")
def task_log(projekt: str, lines: int = 50):
    workspace = workspace_path(projekt)
    log = workspace / "crew_log.txt"
    if not log.exists():
        return {"lines": []}
    text = log.read_text(errors="replace")
    clean = [re.sub(r'\x1b\[[0-9;]*m', '', l) for l in text.splitlines()]
    return {"lines": clean[-lines:]}

@app.get("/api/projects/{projekt}/outputs")
def list_outputs(projekt: str):
    workspace = workspace_path(projekt)
    if not workspace.exists():
        return []
    files = []
    for f in sorted(workspace.glob("*.md"), key=lambda x: x.stat().st_mtime, reverse=True):
        files.append({
            "name": f.name,
            "size": f.stat().st_size,
            "modified": f.stat().st_mtime,
        })
    return files

@app.get("/api/projects/{projekt}/outputs/file")
def read_output_file(projekt: str, name: str = Query(...)):
    workspace = workspace_path(projekt)
    soubor = (workspace / name).resolve()
    if not str(soubor).startswith(str(workspace)):
        raise HTTPException(403, "Přístup odepřen")
    if not soubor.exists():
        raise HTTPException(404, "Soubor nenalezen")
    return {"name": name, "content": soubor.read_text(encoding="utf-8")}

@app.get("/api/projects/{projekt}/conversations")
def get_conversations(projekt: str, limit: int = 20):
    return nacti_historii(projekt, max_zprav=limit)

# --- Prefect & LangFuse helpers ---

def _duration_s(start: str | None, end: str | None) -> float | None:
    if not start or not end:
        return None
    try:
        fmt = "%Y-%m-%dT%H:%M:%S.%f+00:00"
        a = datetime.strptime(start[:26] + "+00:00", fmt)
        b = datetime.strptime(end[:26]   + "+00:00", fmt)
        return round((b - a).total_seconds(), 1)
    except Exception:
        return None

def _normalize_flow_run(r: dict) -> dict:
    params  = r.get("parameters") or {}
    state   = r.get("state") or {}
    return {
        "id":           r.get("id", ""),
        "name":         r.get("name", ""),
        "task_id":      params.get("task_id", ""),
        "projekt":      params.get("projekt", ""),
        "mode":         params.get("mode", "full"),
        "status":       state.get("type", "UNKNOWN"),
        "started_at":   r.get("start_time"),
        "completed_at": r.get("end_time"),
        "duration_s":   _duration_s(r.get("start_time"), r.get("end_time")),
    }

def _block_type_from_name(name: str, obs_type: str) -> str:
    n = name.lower()
    if any(k in n for k in ("plan", "planning", "bot-planning")):
        return "plan"
    if any(k in n for k in ("agent", "crew", "průzkum", "analytik", "syntetiz", "executor")):
        return "agent"
    if any(k in n for k in ("summary", "souhrn", "výstup", "result")):
        return "summary"
    if obs_type == "GENERATION":
        return "generation"
    return "span"

def _normalize_trace(trace: dict) -> dict:
    observations = trace.get("observations") or []

    # Sestavení stromu: id → observation
    obs_map  = {o["id"]: o for o in observations}
    obs_ids  = set(obs_map)

    # Kořenové observace (bez rodiče nebo rodič není v sadě)
    roots = [
        o for o in observations
        if not o.get("parentObservationId") or o["parentObservationId"] not in obs_ids
    ]
    roots.sort(key=lambda o: o.get("startTime") or "")

    # Děti každé observace (tool cally, sub-spany)
    children_of: dict[str, list] = {}
    for o in observations:
        pid = o.get("parentObservationId")
        if pid and pid in obs_ids:
            children_of.setdefault(pid, []).append(o)

    # Tokeny a náklady napříč celou trace
    total_local = 0
    total_cloud = 0
    total_cost  = 0.0
    cloud_keywords = ("claude", "gpt", "gemini", "openai", "anthropic")
    for o in observations:
        usage = o.get("usage") or {}
        toks  = usage.get("totalTokens") or usage.get("total") or 0
        cost  = float(o.get("calculatedTotalCost") or 0)
        model = (o.get("model") or "").lower()
        if any(k in model for k in cloud_keywords):
            total_cloud += toks
        else:
            total_local += toks
        total_cost += cost

    # Sestavení bloků
    blocks = []
    for obs in roots:
        name     = obs.get("name") or ""
        obs_type = obs.get("type", "SPAN")
        btype    = _block_type_from_name(name, obs_type)
        children = sorted(children_of.get(obs["id"], []), key=lambda o: o.get("startTime") or "")
        usage    = obs.get("usage") or {}

        block: dict = {
            "type":        btype,
            "name":        name,
            "ts":          obs.get("startTime"),
            "duration_ms": _duration_s(obs.get("startTime"), obs.get("endTime")),
            "level":       obs.get("level", "DEFAULT"),
        }

        if btype in ("plan", "summary", "span"):
            # Textový obsah — preferuj output, fallback na input
            content = obs.get("output") or obs.get("input") or ""
            block["content"] = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)

        elif btype in ("agent", "generation"):
            block["model"]    = obs.get("model") or ""
            block["prompt"]   = obs.get("input")
            block["response"] = obs.get("output")
            block["tokens"]   = usage.get("totalTokens") or usage.get("total") or 0
            block["tool_calls"] = [
                {
                    "name":   c.get("name", ""),
                    "input":  c.get("input"),
                    "output": c.get("output"),
                    "ts":     c.get("startTime"),
                }
                for c in children
            ]

        blocks.append(block)

    # Timestamp posledního konce
    end_times = [o.get("endTime") for o in observations if o.get("endTime")]
    completed_at = max(end_times) if end_times else None

    metadata = trace.get("metadata") or {}
    return {
        "trace_id":     trace.get("id", ""),
        "task_id":      trace.get("name", "").removeprefix("evo-task-"),
        "projekt":      metadata.get("projekt") or trace.get("name", ""),
        "status":       "ERROR" if trace.get("level") == "ERROR" else "COMPLETED",
        "started_at":   trace.get("createdAt"),
        "completed_at": completed_at,
        "tokens":       {"local": total_local, "cloud": total_cloud},
        "cost_usd":     round(total_cost, 6),
        "blocks":       blocks,
    }


# --- Nové endpointy ---

@app.get("/api/projects/{projekt}/tasks")
async def list_tasks(projekt: str):
    """Seznam Prefect flow runs pro daný projekt."""
    projekt_path(projekt)  # validace existence projektu
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{PREFECT_API}/flow_runs/filter",
                json={"sort": "START_TIME_DESC", "limit": 50},
            )
            resp.raise_for_status()
            all_runs = resp.json()

        # Filtruj podle projektu v parametrech flow runu
        projekt_runs = [
            r for r in all_runs
            if isinstance(r.get("parameters"), dict)
            and r["parameters"].get("projekt") == projekt
        ]
        return [_normalize_flow_run(r) for r in projekt_runs]

    except httpx.ConnectError:
        raise HTTPException(503, "Prefect server nedostupný")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/projects/{projekt}/tasks/{task_id}")
async def get_task_trace(projekt: str, task_id: str):
    """
    Vrátí normalizovaný LangFuse trace pro daný task.

    Struktura odpovědi:
      trace_id, task_id, projekt, status, started_at, completed_at,
      tokens: {local, cloud}, cost_usd,
      blocks: [
        {type: "plan", content, ts, level},
        {type: "agent", name, model, prompt, response, tool_calls, tokens, ts},
        {type: "summary", content, ts},
        {type: "generation"|"span", ...}
      ]
    """
    projekt_path(projekt)

    if not LANGFUSE_PK:
        raise HTTPException(503, "LangFuse není nakonfigurován")

    trace_name = f"evo-task-{task_id}"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # Vyhledej trace podle jména
            resp = await client.get(
                f"{LANGFUSE_HOST}/api/public/traces",
                auth=(LANGFUSE_PK, LANGFUSE_SK),
                params={"name": trace_name, "limit": 1},
            )
            resp.raise_for_status()
            traces = resp.json().get("data", [])

        if not traces:
            raise HTTPException(404, f"Trace '{trace_name}' nenalezen v LangFuse")

        trace_id = traces[0]["id"]

        # Načti plný trace s observacemi
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{LANGFUSE_HOST}/api/public/traces/{trace_id}",
                auth=(LANGFUSE_PK, LANGFUSE_SK),
            )
            resp.raise_for_status()
            trace = resp.json()

        return _normalize_trace(trace)

    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(503, "LangFuse nedostupný")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/langfuse/costs")
async def langfuse_costs():
    """
    Náklady a tokeny za posledních 7 dní z LangFuse.
    Vrátí celkový přehled + daily breakdown.
    """
    if not LANGFUSE_PK:
        raise HTTPException(503, "LangFuse není nakonfigurován")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{LANGFUSE_HOST}/api/public/metrics/daily",
                auth=(LANGFUSE_PK, LANGFUSE_SK),
            )
            resp.raise_for_status()
            data = resp.json().get("data", [])

        daily = data[-7:]
        return {
            "daily": [
                {
                    "date":         d.get("date", "")[:10],
                    "tokens":       d.get("totalTokens", 0),
                    "cost_usd":     round(float(d.get("totalCost") or 0), 6),
                    "observations": d.get("countObservations", 0),
                    "traces":       d.get("countTraces", 0),
                }
                for d in daily
            ],
            "total_7d_usd":    round(sum(float(d.get("totalCost") or 0) for d in daily), 6),
            "total_7d_tokens": sum(d.get("totalTokens", 0) for d in daily),
        }
    except HTTPException:
        raise
    except httpx.ConnectError:
        raise HTTPException(503, "LangFuse nedostupný")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/projects/{projekt}/knowledge/gitdiff")
async def knowledge_gitdiff(projekt: str, file: str, sha: str):
    """
    Vrátí obsah souboru ve verzi 'sha' a v předchozím commitu (parent).
    Určeno pro Monaco DiffEditor — original=parent, modified=sha.
    """
    kb = knowledge_path(projekt)
    import git as gitlib
    try:
        repo = gitlib.Repo(kb)
        commit = repo.commit(sha)

        def blob_content(tree, path: str) -> str:
            try:
                return tree[path].data_stream.read().decode("utf-8", errors="replace")
            except (KeyError, AttributeError):
                return ""

        content_new = blob_content(commit.tree, file)
        content_old = blob_content(commit.parents[0].tree, file) if commit.parents else ""

        return {
            "original": content_old,
            "modified": content_new,
            "sha":      sha,
            "message":  commit.message.strip(),
            "author":   str(commit.author),
            "ts":       commit.committed_datetime.isoformat(),
        }
    except gitlib.InvalidGitRepositoryError:
        raise HTTPException(404, "Git repo neexistuje")
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/projects/{projekt}/knowledge/index_status")
def knowledge_index_status(projekt: str):
    """Vrátí stav indexace KB vůči Qdrantu."""
    kb = knowledge_path(projekt)
    if not kb.exists():
        raise HTTPException(404, "KB neexistuje")

    last_indexed_file = kb / ".last_indexed"
    last_indexed_ts = float(last_indexed_file.read_text().strip()) if last_indexed_file.exists() else 0.0

    changed, newest_mtime = 0, 0.0
    for f in kb.rglob("*.md"):
        mtime = f.stat().st_mtime
        if mtime > newest_mtime:
            newest_mtime = mtime
        if mtime > last_indexed_ts:
            changed += 1

    return {
        "needs_reindex": changed > 0,
        "changed_files": changed,
        "last_indexed": datetime.fromtimestamp(last_indexed_ts).isoformat() if last_indexed_ts else None,
    }


async def _run_indexer(projekt: str):
    """Spustí kb_indexer.py jako subprocess s env vars pro Docker síť."""
    env = os.environ.copy()
    env["QDRANT_URL"] = QDRANT_URL
    env["OLLAMA_URL"] = OLLAMA_URL
    proc = await asyncio.create_subprocess_exec(
        "python3", "/opt/evostack/kb_indexer.py", "--project", projekt,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        import logging
        logging.error(f"KB indexer selhal pro {projekt}: {stderr.decode()}")


@app.post("/api/projects/{projekt}/knowledge/reindex")
async def knowledge_reindex(projekt: str, background_tasks: BackgroundTasks):
    """Spustí reindexaci KB projektu na pozadí."""
    projekt_path(projekt)
    background_tasks.add_task(_run_indexer, projekt)
    return {"started": True}


@app.get("/api/projects/{projekt}/knowledge/gitlog")
async def knowledge_gitlog(projekt: str, file: str = ""):
    """
    Git log pro KB repozitář. Pokud je zadán parametr file, vrátí commity
    které se dotýkají daného souboru (relativní cesta od kořene KB).
    Vrátí posledních 10 commitů.
    """
    kb = knowledge_path(projekt)
    if not kb.exists():
        raise HTTPException(404, "KB neexistuje")
    import git as gitlib
    try:
        repo = gitlib.Repo(kb)
        kwargs: dict = {"max_count": 10}
        if file:
            kwargs["paths"] = file
        zaznamy = []
        for c in repo.iter_commits(**kwargs):
            zaznamy.append({
                "sha":     c.hexsha[:8],
                "message": c.message.strip(),
                "author":  str(c.author),
                "ts":      c.committed_datetime.isoformat(),
            })
        return zaznamy
    except gitlib.InvalidGitRepositoryError:
        return []
    except Exception as e:
        raise HTTPException(500, str(e))


# --- WebSocket Chat ---

SYSTEM_PROMPT_TEMPLATE = """Jsi AI asistent projektu EVO. Aktuální projekt: **{projekt}**

## Kontext projektu (knowledge base)
{knowledge}

Odpovídáš česky. Jsi konkrétní, stručný a pracuješ s fakty z knowledge base."""

@app.websocket("/api/chat")
async def websocket_chat(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            data = await ws.receive_json()
            projekt = data.get("projekt", "legai")
            zprava_text = data.get("zprava", "")

            if not zprava_text:
                continue

            # Ulož do historie
            uloz_do_historie(projekt, "user", zprava_text)

            # Sestav kontext
            knowledge = nacti_knowledge(projekt)
            historie = nacti_historii(projekt, max_zprav=8)
            system = SYSTEM_PROMPT_TEMPLATE.format(projekt=projekt, knowledge=knowledge[:4000])

            zpravy = (
                [{"role": "system", "content": system}]
                + [{"role": m["role"], "content": m["content"]} for m in historie]
                + [{"role": "user", "content": zprava_text}]
            )

            # Stream odpověď z Ollama
            full_response = ""
            try:
                async with httpx.AsyncClient(timeout=300) as client:
                    async with client.stream(
                        "POST",
                        f"{OLLAMA_URL}/api/chat",
                        json={"model": PLANNER_MODEL, "messages": zpravy, "stream": True, "options": {"temperature": 0.1}}
                    ) as resp:
                        async for line in resp.aiter_lines():
                            if not line:
                                continue
                            try:
                                chunk = json.loads(line)
                                token = chunk.get("message", {}).get("content", "")
                                if token:
                                    full_response += token
                                    await ws.send_json({"type": "token", "content": token})
                                if chunk.get("done"):
                                    await ws.send_json({"type": "done"})
                            except Exception:
                                pass
            except Exception as e:
                await ws.send_json({"type": "error", "content": str(e)})

            # Ulož odpověď do historie
            if full_response:
                uloz_do_historie(projekt, "assistant", full_response)

    except WebSocketDisconnect:
        pass


# ═══════════════════════════════════════════════════════════════════════════════
# CHATY — volné konverzace bez vazby na projekt
# Datová struktura:
#   /data/chats/{id}/messages.jsonl   ← zprávy
#   /data/chats/{id}/metadata.json    ← název, datum, persona konfigurace
#   /data/chats/workspace/{id}/       ← výstupy uložené z chatu
# ═══════════════════════════════════════════════════════════════════════════════

CHATS_DIR = DATA_DIR / "chats"

# --- Pydantic modely pro chaty ---

class ChatCreate(BaseModel):
    title: Optional[str] = None
    personas: list[str] = []

class ChatMessageCreate(BaseModel):
    content: str
    model: Optional[str] = None      # override modelu, default evo-fast

class ChatOutputSave(BaseModel):
    filename: str
    content: str                      # text obsah (MD, TXT...)

# --- Helpers ---

def chat_dir(chat_id: str) -> Path:
    return CHATS_DIR / chat_id

def chat_workspace(chat_id: str) -> Path:
    return CHATS_DIR / "workspace" / chat_id

def _read_chat_metadata(chat_id: str) -> dict:
    meta_file = chat_dir(chat_id) / "metadata.json"
    if not meta_file.exists():
        raise HTTPException(404, f"Chat '{chat_id}' nenalezen")
    return json.loads(meta_file.read_text())

def _read_chat_messages(chat_id: str) -> list[dict]:
    msg_file = chat_dir(chat_id) / "messages.jsonl"
    if not msg_file.exists():
        return []
    return [json.loads(l) for l in msg_file.read_text().splitlines() if l.strip()]

def _append_message(chat_id: str, role: str, content: str, model: str = "") -> dict:
    msg = {
        "id":      str(uuid.uuid4())[:8],
        "role":    role,
        "content": content,
        "ts":      datetime.now().isoformat(),
    }
    if model:
        msg["model"] = model
    msg_file = chat_dir(chat_id) / "messages.jsonl"
    with open(msg_file, "a") as f:
        f.write(json.dumps(msg, ensure_ascii=False) + "\n")
    return msg

def _update_metadata(chat_id: str, updates: dict):
    meta = _read_chat_metadata(chat_id)
    meta.update(updates)
    (chat_dir(chat_id) / "metadata.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2)
    )

def _count_outputs(chat_id: str) -> int:
    ws = chat_workspace(chat_id)
    return len(list(ws.iterdir())) if ws.exists() else 0

def _build_system_prompt(personas: list[str]) -> str:
    base = (
        "Jsi EVO asistent — inteligentní AI na serveru EVO-X2. "
        "Odpovídej v češtině, stručně a konkrétně. "
        "Jsi k dispozici pro volné konverzace, analýzy, výzkum a brainstorming. "
        "Pokud uživatel chce uložit výsledek, řekni mu to — sám nič neukládáš."
    )
    if personas:
        persona_str = ", ".join(personas)
        base += (
            f"\n\nAktivní persony: {persona_str}. "
            "Každou personu uváděj jejím jménem ve formátu '**[Jméno]:**' před odpovědí. "
            "Po max 2 kolech každé persony syntetizuj pohled do souhrnné odpovědi."
        )
    return base

# --- Endpointy ---

@app.post("/api/chats")
def create_chat(body: ChatCreate):
    """Vytvoří nový chat. Vrátí metadata včetně vygenerovaného ID."""
    chat_id = str(uuid.uuid4())[:12]
    chat_dir(chat_id).mkdir(parents=True, exist_ok=True)
    meta = {
        "id":           chat_id,
        "title":        body.title or "Nový chat",
        "created_at":   datetime.now().isoformat(),
        "updated_at":   datetime.now().isoformat(),
        "message_count": 0,
        "output_count": 0,
        "personas":     body.personas,
    }
    (chat_dir(chat_id) / "metadata.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=2)
    )
    return meta


@app.get("/api/chats")
def list_chats():
    """Seznam všech chatů seřazený od nejnovějšího."""
    CHATS_DIR.mkdir(parents=True, exist_ok=True)
    chats = []
    for d in CHATS_DIR.iterdir():
        if not d.is_dir() or d.name == "workspace":
            continue
        meta_file = d / "metadata.json"
        if not meta_file.exists():
            continue
        meta = json.loads(meta_file.read_text())
        # Aktuální počty (bez ohledu na cached hodnoty v metadata)
        msgs = _read_chat_messages(meta["id"])
        meta["message_count"] = len(msgs)
        meta["output_count"]  = _count_outputs(meta["id"])
        # Poslední zpráva pro preview
        last = next((m for m in reversed(msgs) if m["role"] == "user"), None)
        meta["last_message"] = last["content"][:120] if last else ""
        chats.append(meta)
    chats.sort(key=lambda c: c.get("updated_at", ""), reverse=True)
    return chats


@app.get("/api/chats/{chat_id}")
def get_chat(chat_id: str):
    """Detail chatu s kompletní historií zpráv."""
    meta = _read_chat_metadata(chat_id)
    messages = _read_chat_messages(chat_id)
    meta["message_count"] = len(messages)
    meta["output_count"]  = _count_outputs(chat_id)
    return {**meta, "messages": messages}


@app.post("/api/chats/{chat_id}/messages")
async def send_message(chat_id: str, body: ChatMessageCreate):
    """
    Odešle zprávu do chatu a vrátí odpověď modelu jako SSE stream.

    SSE formát:
      data: {"type": "token", "content": "..."}\\n\\n   ← průběžné tokeny
      data: {"type": "done",  "message": {...}}\\n\\n    ← hotovo + uložená zpráva
      data: {"type": "error", "content": "..."}\\n\\n    ← chyba
    """
    meta = _read_chat_metadata(chat_id)
    history = _read_chat_messages(chat_id)

    # Ulož user zprávu
    _append_message(chat_id, "user", body.content)

    # Nastav název chatu z první zprávy
    if not history and meta["title"] == "Nový chat":
        title = body.content[:60].strip()
        _update_metadata(chat_id, {"title": title, "updated_at": datetime.now().isoformat()})

    # Sestav zprávy pro LiteLLM
    system_prompt = _build_system_prompt(meta.get("personas", []))
    llm_messages = [{"role": "system", "content": system_prompt}]
    # Posledních 20 zpráv jako kontext
    for m in history[-20:]:
        llm_messages.append({"role": m["role"], "content": m["content"]})
    llm_messages.append({"role": "user", "content": body.content})

    pouzity_model = body.model or "evo-fast"
    litellm_key = os.getenv("LITELLM_MASTER_KEY", LITELLM_KEY)

    async def generate():
        full_content = ""
        try:
            async with httpx.AsyncClient(timeout=300) as client:
                async with client.stream(
                    "POST",
                    f"{LITELLM_URL}/chat/completions",
                    headers={"Authorization": f"Bearer {litellm_key}"},
                    json={
                        "model":    pouzity_model,
                        "messages": llm_messages,
                        "stream":   True,
                        "temperature": 0.3,
                    },
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data = line[6:]
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                            token = chunk["choices"][0]["delta"].get("content", "")
                            if token:
                                full_content += token
                                yield f"data: {json.dumps({'type': 'token', 'content': token}, ensure_ascii=False)}\n\n"
                        except Exception:
                            pass

            # Ulož asistentovu odpověď
            saved_msg = _append_message(chat_id, "assistant", full_content, model=pouzity_model)
            _update_metadata(chat_id, {"updated_at": datetime.now().isoformat()})
            yield f"data: {json.dumps({'type': 'done', 'message': saved_msg}, ensure_ascii=False)}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/chats/{chat_id}/outputs")
def get_chat_outputs(chat_id: str):
    """Seznam souborů uložených z tohoto chatu do workspace."""
    _read_chat_metadata(chat_id)  # validace existence
    ws = chat_workspace(chat_id)
    if not ws.exists():
        return []
    outputs = []
    for f in sorted(ws.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if f.is_file():
            outputs.append({
                "filename": f.name,
                "size":     f.stat().st_size,
                "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat(),
                "path":     str(f.relative_to(CHATS_DIR)),
            })
    return outputs


@app.post("/api/chats/{chat_id}/outputs")
def save_chat_output(chat_id: str, body: ChatOutputSave):
    """Uloží soubor do workspace tohoto chatu."""
    _read_chat_metadata(chat_id)  # validace existence
    ws = chat_workspace(chat_id)
    ws.mkdir(parents=True, exist_ok=True)

    # Sanitize filename — jen alfanumerické, pomlčky, podtržítka, tečky
    safe_name = re.sub(r"[^\w\.\-]", "_", body.filename)
    target = (ws / safe_name).resolve()
    if not str(target).startswith(str(ws)):
        raise HTTPException(403, "Neplatná cesta souboru")

    target.write_text(body.content, encoding="utf-8")
    _update_metadata(chat_id, {"updated_at": datetime.now().isoformat()})
    return {"ok": True, "path": str(target.relative_to(CHATS_DIR))}
