"""
EVO Bot Server — Telegram rozhraní pro řízení AI agentů.

Architektura:
  - LiteLLM proxy (localhost:4000) pro všechna volání modelů
  - Prefect API (localhost:4200) pro spouštění flows
  - LangFuse pro tracing konverzací
  - Webhook server (localhost:9001) pro notifikace z Prefect flows

Příkazy:
  /start         — uvítání a seznam příkazů
  /projekt       — přepnutí projektu
  /projekty      — seznam projektů
  /stav          — aktuální stav bota a workspace
  /pamet         — KB výtah + délka historie
  /log           — posledních 30 řádků logu
  /potvrdit      — spustí Prefect flow pro schválený plán
  /poc           — spustí PoC run (mode=probe, 10 % rozsahu)
  /agenti        — správa agentů (stub)
  /model         — override modelu pro session
  /budget        — tokeny a náklady z LangFuse
  /zrusit        — zrušení aktuálního úkolu
"""

import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime
from enum import Enum
from pathlib import Path

import httpx
from aiohttp import web
from dotenv import load_dotenv
from langfuse import Langfuse
from telegram import Update
from telegram.ext import (
    Application, CommandHandler, ContextTypes, MessageHandler, filters
)
import kb_git

load_dotenv("/opt/evostack/.env")

# ─── Konfigurace ──────────────────────────────────────────────────────────────

BOT_TOKEN       = os.getenv("TELEGRAM_BOT_TOKEN")
CHAT_ID         = int(os.getenv("TELEGRAM_CHAT_ID"))
LITELLM_URL     = "http://localhost:4000"
LITELLM_KEY     = os.getenv("LITELLM_MASTER_KEY")
PREFECT_API     = os.getenv("PREFECT_API_URL", "http://10.10.0.2:4200/api")
WEBHOOK_PORT    = 9001
DATA_DIR        = Path("/data")
KNOWLEDGE_EVO   = DATA_DIR / "knowledge" / "evo"
PROJECTS_DIR    = DATA_DIR / "projects"

DEFAULT_PLANNER = "evo-planner"   # deepseek-r1:32b — reasoning, plánování
DEFAULT_FAST    = "evo-fast"      # qwen2.5:14b — rychlé odpovědi, klasifikace

logging.basicConfig(format="%(asctime)s [%(levelname)s] %(message)s", level=logging.INFO)
log = logging.getLogger(__name__)

# ─── LangFuse ─────────────────────────────────────────────────────────────────

try:
    langfuse = Langfuse(
        public_key=os.getenv("LANGFUSE_PUBLIC_KEY"),
        secret_key=os.getenv("LANGFUSE_SECRET_KEY"),
        host=os.getenv("LANGFUSE_HOST", "http://10.10.0.2:3002"),
    )
except Exception as e:
    log.warning(f"LangFuse inicializace selhala: {e} — tracing vypnutý")
    langfuse = None

# ─── Stav ─────────────────────────────────────────────────────────────────────

class Stav(Enum):
    IDLE             = "idle"
    PLANUJE          = "planuje"
    CEKA_NA_PROJEKT  = "ceka_na_projekt"
    DISKUZE          = "diskuze"
    POC              = "poc"
    EXEKUCE          = "exekuce"
    ESKALACE         = "eskalace"

stav                     = Stav.IDLE
aktivni_projekt          = None        # None = projekt nebyl explicitně zvolen
konverzace               = []          # aktuální konverzační vlákno (v paměti)
model_override           = None        # /model příkaz — None = použít default
aktivni_flow_id          = None        # ID běžícího Prefect flow run
eskalace_pending         = None        # {"flow_run_id": ..., "moznosti": [...]}
cekajici_ukol            = None        # uložený text úkolu při čekání na projekt

# Telegram Application (pro použití z webhooku)
_tg_app: Application | None = None

# ─── Cesty projektu ───────────────────────────────────────────────────────────

def projekt_dir() -> Path:
    return PROJECTS_DIR / (aktivni_projekt or "")

def knowledge_dir() -> Path:
    return projekt_dir() / "knowledge"

def conversations_dir() -> Path:
    d = projekt_dir() / "conversations"
    d.mkdir(parents=True, exist_ok=True)
    return d

def workspace_dir() -> Path:
    d = projekt_dir() / "envs" / "proto" / "workspace"
    d.mkdir(parents=True, exist_ok=True)
    return d

# ─── Knowledge Base ───────────────────────────────────────────────────────────

def nacti_knowledge(max_znaku: int = 6000) -> str:
    """Načte prioritizované části KB aktivního projektu + globální EVO KB."""
    sekce = []

    if KNOWLEDGE_EVO.exists():
        for f in sorted(KNOWLEDGE_EVO.rglob("*.md")):
            try:
                sekce.append(f"### [EVO] {f.stem}\n{f.read_text()[:800]}")
            except Exception:
                pass

    kb = knowledge_dir()
    if kb.exists():
        priority = [
            "technicka", "vecna", "hypotezy/aktivni",
            "scenare/prioritizovane", "rozhodnuti", "procesni", "experimenty",
        ]
        for kategorie in priority:
            kat_dir = kb / kategorie
            if not kat_dir.exists():
                continue
            for f in sorted(kat_dir.rglob("*.md"))[:3]:
                try:
                    sekce.append(f"### [{kategorie}] {f.stem}\n{f.read_text()[:600]}")
                except Exception:
                    pass

    obsah = "\n\n".join(sekce)
    return obsah[:max_znaku] if len(obsah) > max_znaku else obsah


def uloz_do_knowledge(kategorie: str, nazev: str, obsah: str, task_id: str = "manual"):
    """Uloží poznatek do KB a commitne přes GitPython (kb_git modul)."""
    rel_path = f"{kategorie}/{nazev}.md"
    try:
        kb_git.uloz_soubor(
            kb_path=knowledge_dir(),
            rel_path=rel_path,
            obsah=obsah,
            task_id=task_id,
            popis=f"Aktualizace KB: {rel_path}",
        )
    except Exception as e:
        log.error(f"KB commit selhal ({rel_path}): {e}")

# ─── Historie konverzací ──────────────────────────────────────────────────────

def nacti_historii(max_zprav: int = 10, pouze_tasky: bool = False) -> list[dict]:
    soubor = conversations_dir() / "historie.jsonl"
    if not soubor.exists():
        return []
    radky = soubor.read_text().strip().splitlines()
    zaznamy = [json.loads(r) for r in radky if r.strip()]
    if pouze_tasky:
        zaznamy = [z for z in zaznamy if z.get("typ") == "task"]
    return zaznamy[-max_zprav:]

def uloz_do_historie(role: str, content: str, typ: str = "chat"):
    """typ: 'chat' pro konverzaci, 'task' pro plánování a tasky."""
    soubor = conversations_dir() / "historie.jsonl"
    zaznam = {
        "role": role, "content": content, "typ": typ,
        "ts": datetime.now().isoformat(), "projekt": aktivni_projekt,
    }
    with open(soubor, "a") as f:
        f.write(json.dumps(zaznam, ensure_ascii=False) + "\n")

# ─── System prompt ────────────────────────────────────────────────────────────

def sestav_system_prompt() -> str:
    knowledge = nacti_knowledge()
    model = model_override or DEFAULT_PLANNER
    return f"""Jsi orchestrátor AI agentů na serveru EVO-X2. Aktuální projekt: **{aktivni_projekt}**

## Infrastruktura
- Modely přes LiteLLM proxy (localhost:4000):
  - evo-planner = deepseek-r1:32b (reasoning, plánování)
  - evo-executor = qwen2.5:72b (agenti s tool calling)
  - evo-fast = qwen2.5:14b (rychlá klasifikace, shrnutí)
  - claude-sonnet / claude-opus (cloud, složitý kontext)
- Aktivní model: {model}
- Workflow orchestrace: Prefect (localhost:4200)
- Vektorová KB: Qdrant (localhost:6333), kolekce "kb"
- Tracing: LangFuse (10.10.0.2:3002)
- Data projektu: /data/projects/{aktivni_projekt}/
- Knowledge base: /data/projects/{aktivni_projekt}/knowledge/
- Workspace: /data/projects/{aktivni_projekt}/envs/proto/workspace/

## Tvoje jediná role v této fázi
Jsi PLÁNOVAČ. Dostáváš zadání úkolu a musíš navrhnout postup pro agenty.
NIKDY neprováděj úkol sám. NIKDY nevypisuj výsledky ani shrnutí dat.
Vždy odpověz přesně v šabloně níže a skonči řádkem s příkazy.

## Výstup — VŽDY přesně tato struktura, nic jiného:
📋 **Navrhovaný postup:**
1. [konkrétní krok]
2. [konkrétní krok]
3. ...

🤖 **Agenti:** [role agentů oddělené čárkou]
⏱ **Odhadovaný čas:** [X min]
💰 **Cloud tokeny:** [odhad nebo "0 — jen lokální modely"]
⚠️ **Rizika:** [nebo "žádná"]

/potvrdit | /poc | /zrusit

## Pravidla
- Pokud zadání vyžaduje data která nemáš → naplánuj jejich získání jako krok
- Nikdy nepiš do souborů mimo /data/projects/ a /data/knowledge/
- Každá autonomní změna KB = git commit s prefixem [EVO][task-id]

## Knowledge Base projektu
{knowledge if knowledge else '(zatím prázdná)'}"""

# ─── LiteLLM client ───────────────────────────────────────────────────────────

async def litellm_chat(zpravy: list[dict], model: str | None = None) -> str:
    """Zavolá LiteLLM proxy a vrátí odpověď modelu."""
    pouzity_model = model or model_override or DEFAULT_PLANNER
    async with httpx.AsyncClient(timeout=600) as client:
        resp = await client.post(
            f"{LITELLM_URL}/chat/completions",
            headers={"Authorization": f"Bearer {LITELLM_KEY}"},
            json={"model": pouzity_model, "messages": zpravy, "temperature": 0.1},
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

async def klasifikuj_zamer(text: str) -> str:
    """
    Klasifikuje zprávu jako A (konverzace) nebo B (úkol k exekuci).
    Volá evo-fast (qwen2.5:14b) — rychlé a levné.
    Vrátí "A" nebo "B".
    """
    zpravy = [
        {
            "role": "system",
            "content": (
                "Klasifikuj zprávu uživatele jako:\n"
                "A — konverzační otázka nebo dotaz (lze odpovědět přímo, nevyžaduje spuštění agentů ani zápis do souborů)\n"
                "B — úkol k provedení agentem (vyžaduje plánování, exekuci, práci se soubory, analýzu, výzkum)\n\n"
                "Odpověz POUZE jediným písmenem: A nebo B. Nic jiného."
            ),
        },
        {"role": "user", "content": text},
    ]
    try:
        odpoved = await litellm_chat(zpravy, model=DEFAULT_FAST)
        prvni = odpoved.strip().upper()[:1]
        return prvni if prvni in ("A", "B") else "B"  # při nejistotě → plán
    except Exception:
        return "B"  # při chybě → plán (bezpečnější)

def sestav_system_prompt_konverzace() -> str:
    knowledge = nacti_knowledge() if aktivni_projekt else ""
    projekt_info = f"Aktuální projekt: **{aktivni_projekt}**\n\n" if aktivni_projekt else ""
    kb_sekce = f"## Knowledge Base projektu\n{knowledge}\n\n" if knowledge else ""
    return (
        f"Jsi asistent EVO bota na serveru EVO-X2. {projekt_info}"
        f"{kb_sekce}"
        "Odpovídej stručně a přímo v češtině na základě dostupného kontextu. "
        "Pokud informace v KB nejsou, řekni to. "
        "Nenavrhuj plány ani kroky — jen odpověz."
    )

# ─── Prefect API ──────────────────────────────────────────────────────────────

async def spust_flow(
    projekt: str, zadani: str, task_id: str,
    mode: str = "full",
    deployment_name: str = "evo-main-flow",
) -> str | None:
    """
    Spustí Prefect flow run přes API.
    Vrátí flow_run_id nebo None pokud deployment neexistuje.
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{PREFECT_API}/deployments/filter",
            json={"deployments": {"name": {"any_": [deployment_name]}}},
        )
        deployments = resp.json()
        if not deployments:
            log.warning(f"Deployment '{deployment_name}' nenalezen v Prefect")
            return None

        deployment_id = deployments[0]["id"]
        resp = await client.post(
            f"{PREFECT_API}/deployments/{deployment_id}/create_flow_run",
            json={
                "name": f"evo-{task_id}",
                "parameters": {
                    "projekt": projekt, "zadani": zadani,
                    "task_id": task_id, "mode": mode,
                },
            },
        )
        resp.raise_for_status()
        flow_run_id = resp.json()["id"]
        log.info(f"Flow run spuštěn: {flow_run_id} (mode={mode})")
        return flow_run_id


async def zrus_flow(flow_run_id: str):
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(
            f"{PREFECT_API}/flow-runs/{flow_run_id}/set_state",
            json={"state": {"type": "CANCELLED"}},
        )

# ─── Helpers ──────────────────────────────────────────────────────────────────

def only_owner(func):
    async def wrapper(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
        if update.effective_chat.id != CHAT_ID:
            return
        return await func(update, ctx)
    return wrapper

async def send(ctx, text: str):
    """Odešle zprávu, rozdělí na chunky pokud > 4000 znaků."""
    for i in range(0, len(text), 4000):
        await ctx.bot.send_message(chat_id=CHAT_ID, text=text[i:i+4000])

async def send_raw(text: str):
    """Odešle zprávu bez kontextu handleru (pro webhook notifikace)."""
    if _tg_app is None:
        return
    for i in range(0, len(text), 4000):
        await _tg_app.bot.send_message(chat_id=CHAT_ID, text=text[i:i+4000])

# ─── Příkazy ──────────────────────────────────────────────────────────────────

@only_owner
async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    global stav, konverzace, aktivni_projekt, cekajici_ukol
    stav, konverzace, cekajici_ukol = Stav.IDLE, [], None
    projekt_info = f"Projekt: *{aktivni_projekt}*" if aktivni_projekt else "Žádný aktivní projekt (bude dotázán při zadání úkolu)"
    await update.message.reply_text(
        f"EVO bot aktivní. {projekt_info}\n\n"
        "Příkazy:\n"
        "/projekt <nazev> — přepne projekt\n"
        "/projekty — seznam projektů\n"
        "/potvrdit — spustí Prefect flow pro schválený plán\n"
        "/poc — spustí PoC run (10 % rozsahu)\n"
        "/zrusit — zruší aktuální úkol\n"
        "/agenti — správa agentů\n"
        "/model <nazev> — override modelu pro session\n"
        "/budget — tokeny a náklady\n"
        "/stav — stav bota a workspace\n"
        "/pamet — KB výtah + historie\n"
        "/log — posledních 30 řádků logu\n\n"
        "Napiš úkol pro zahájení.",
        parse_mode="Markdown",
    )

@only_owner
async def cmd_projekt(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    global aktivni_projekt, stav, konverzace
    args = ctx.args
    if not args:
        projekt_info = f"*{aktivni_projekt}*" if aktivni_projekt else "_(nenastaveno)_"
        await update.message.reply_text(
            f"Aktuální projekt: {projekt_info}\nPoužití: /projekt <nazev>",
            parse_mode="Markdown",
        )
        return
    nazev = args[0].lower()
    if not (PROJECTS_DIR / nazev).exists():
        await update.message.reply_text(f"Projekt '{nazev}' neexistuje v {PROJECTS_DIR}")
        return
    aktivni_projekt = nazev
    stav, konverzace = Stav.IDLE, []
    await update.message.reply_text(f"✅ Přepnuto na projekt: *{aktivni_projekt}*", parse_mode="Markdown")

@only_owner
async def cmd_projekty(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    projekty = sorted(p.name for p in PROJECTS_DIR.iterdir() if p.is_dir()) if PROJECTS_DIR.exists() else []
    radky = "\n".join(f"  {'→' if p == aktivni_projekt else '  '} {p}" for p in projekty)
    await update.message.reply_text(f"Dostupné projekty:\n{radky or '(žádné)'}")

@only_owner
async def cmd_stav(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    model = model_override or DEFAULT_PLANNER
    zprava = f"Stav: *{stav.value}* | Projekt: *{aktivni_projekt}* | Model: *{model}*\n"
    if aktivni_flow_id:
        zprava += f"Flow run: `{aktivni_flow_id}`\n"
    ws = workspace_dir()
    soubory = sorted(ws.glob("*.md"))[-5:] if ws.exists() else []
    if soubory:
        zprava += "\nWorkspace:\n" + "\n".join(
            f"  {f.name} ({f.stat().st_size:,} B)" for f in soubory
        )
    await update.message.reply_text(zprava, parse_mode="Markdown")

@only_owner
async def cmd_pamet(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    knowledge = nacti_knowledge(max_znaku=2000)
    historie = nacti_historii(max_zprav=5)
    zprava = (
        f"*Projekt:* {aktivni_projekt}\n\n"
        f"*Znalostní báze (výtah):*\n{knowledge[:800] if knowledge else '(prázdná)'}\n\n"
        f"*Posledních {len(historie)} zpráv v historii*"
    )
    await send(ctx, zprava)

@only_owner
async def cmd_log(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    log_file = workspace_dir() / "crew_log.txt"
    if not log_file.exists():
        await update.message.reply_text("Log neexistuje.")
        return
    lines = log_file.read_text(errors="replace").splitlines()
    clean = [re.sub(r"\x1b\[[0-9;]*m", "", l) for l in lines[-30:]]
    await send(ctx, "```\n" + "\n".join(clean) + "\n```")

@only_owner
async def cmd_zrusit(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    global stav, konverzace, aktivni_flow_id, eskalace_pending
    if aktivni_flow_id:
        try:
            await zrus_flow(aktivni_flow_id)
            await update.message.reply_text("⏹ Flow run zastaven.")
        except Exception as e:
            await update.message.reply_text(f"⚠️ Flow run se nepodařilo zastavit: {e}")
    stav = Stav.IDLE
    konverzace = []
    aktivni_flow_id = None
    eskalace_pending = None
    await update.message.reply_text("Zrušeno. Napiš nový úkol.")

@only_owner
async def cmd_potvrdit(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    global stav, aktivni_flow_id
    if stav not in (Stav.DISKUZE, Stav.POC):
        await update.message.reply_text("Není co potvrzovat. Nejprve napiš úkol.")
        return

    task_id = str(uuid.uuid4())[:8]
    zadani = next((m["content"] for m in reversed(konverzace) if m["role"] == "user"), "")

    await update.message.reply_text(
        f"🚀 Spouštím flow... (task-id: `{task_id}`)", parse_mode="Markdown"
    )
    stav = Stav.EXEKUCE

    try:
        flow_run_id = await spust_flow(projekt=aktivni_projekt, zadani=zadani,
                                       task_id=task_id, mode="full")
        if flow_run_id:
            aktivni_flow_id = flow_run_id
            await send(ctx,
                f"✅ Flow spuštěn\n"
                f"ID: `{flow_run_id}`\n"
                f"Prefect UI: http://10.10.0.2:4200/flow-runs/flow-run/{flow_run_id}"
            )
        else:
            await send(ctx,
                "⚠️ Deployment 'evo-main-flow' zatím neexistuje.\n"
                "Prefect flow bude připraven v dalším kroku implementace.\n\n"
                f"Task ID pro referenci: `{task_id}`"
            )
            stav = Stav.DISKUZE
    except Exception as e:
        await send(ctx, f"❌ Chyba při spouštění flow: {e}")
        stav = Stav.DISKUZE

@only_owner
async def cmd_poc(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    global stav, aktivni_flow_id
    if stav != Stav.DISKUZE:
        await update.message.reply_text("PoC lze spustit po navržení plánu. Nejprve napiš úkol.")
        return

    task_id = str(uuid.uuid4())[:8]
    zadani = next((m["content"] for m in reversed(konverzace) if m["role"] == "user"), "")

    await update.message.reply_text(
        f"🔬 Spouštím PoC run (10 % rozsahu)... (task-id: `{task_id}`)", parse_mode="Markdown"
    )
    stav = Stav.POC

    try:
        flow_run_id = await spust_flow(projekt=aktivni_projekt, zadani=zadani,
                                       task_id=task_id, mode="probe")
        if flow_run_id:
            aktivni_flow_id = flow_run_id
            await send(ctx, f"✅ PoC flow spuštěn: `{flow_run_id}`")
        else:
            await send(ctx,
                "⚠️ Deployment zatím neexistuje. PoC bude funkční po nasazení flows.\n"
                f"Task ID: `{task_id}`"
            )
            stav = Stav.DISKUZE
    except Exception as e:
        await send(ctx, f"❌ Chyba při spouštění PoC: {e}")
        stav = Stav.DISKUZE

@only_owner
async def cmd_agenti(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🤖 Správa agentů — funkce připravena, agenti se konfigurují.\n\n"
        "Tato funkce bude dostupná po implementaci YAML definic agentů (Priorita 4)."
    )

@only_owner
async def cmd_model(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    global model_override
    dostupne = ["evo-fast", "evo-planner", "evo-executor", "claude-sonnet", "claude-opus", "gpt-4o"]
    args = ctx.args
    if not args:
        aktualni = model_override or f"{DEFAULT_PLANNER} (default)"
        await update.message.reply_text(
            f"Aktuální model: *{aktualni}*\n\n"
            f"Dostupné: {', '.join(dostupne)}\n"
            "Použití: /model <nazev> | /model reset",
            parse_mode="Markdown",
        )
        return
    nazev = args[0].lower()
    if nazev == "reset":
        model_override = None
        await update.message.reply_text(f"Model nastaven na default: *{DEFAULT_PLANNER}*", parse_mode="Markdown")
        return
    if nazev not in dostupne:
        await update.message.reply_text(f"Neznámý model '{nazev}'.\nDostupné: {', '.join(dostupne)}")
        return
    model_override = nazev
    await update.message.reply_text(f"✅ Model pro tuto session: *{model_override}*", parse_mode="Markdown")

@only_owner
async def cmd_budget(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if langfuse is None:
        await update.message.reply_text("LangFuse není dostupný.")
        return
    try:
        pk   = os.getenv("LANGFUSE_PUBLIC_KEY")
        sk   = os.getenv("LANGFUSE_SECRET_KEY")
        host = os.getenv("LANGFUSE_HOST", "http://10.10.0.2:3002")
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{host}/api/public/metrics/daily", auth=(pk, sk))
            resp.raise_for_status()
            data = resp.json().get("data", [])

        if not data:
            await update.message.reply_text("Zatím žádná data v LangFuse.")
            return

        radky = ["*Tokeny a náklady (posledních 7 dní):*\n"]
        celkem_cost = 0.0
        for den in data[-7:]:
            datum = den.get("date", "?")[:10]
            tokeny = den.get("totalTokens", 0)
            cost = den.get("totalCost", 0.0)
            celkem_cost += cost
            radky.append(f"  {datum}: {tokeny:,} tokenů | ${cost:.4f}")
        radky.append(f"\nCelkem 7 dní: *${celkem_cost:.4f}*")
        await send(ctx, "\n".join(radky))

    except Exception as e:
        await update.message.reply_text(f"Chyba při načítání z LangFuse: {e}")

# ─── Eskalační handler ────────────────────────────────────────────────────────

async def eskaluj(flow_run_id: str, zprava_text: str, moznosti: list[str]):
    """Voláno z webhooku — odešle eskalační zprávu a přepne stav na ESKALACE."""
    global stav, eskalace_pending
    stav = Stav.ESKALACE
    eskalace_pending = {"flow_run_id": flow_run_id, "moznosti": moznosti}
    pismena = [chr(65 + i) for i in range(len(moznosti))]
    volby = "\n".join(f"{p}) {m}" for p, m in zip(pismena, moznosti))
    await send_raw(
        f"⚠️ Eskalace z flow `{flow_run_id[:8]}`\n\n"
        f"{zprava_text}\n\n"
        f"Možnosti:\n{volby}\n\n"
        f"Odpověz {'/'.join(pismena)}"
    )

async def zpracuj_odpoved_na_eskalaci(volba: str) -> bool:
    """Zpracuje odpověď na eskalaci a resumuje Prefect flow. Vrátí True při úspěchu."""
    global stav, eskalace_pending, aktivni_flow_id
    if eskalace_pending is None:
        return False

    moznosti = eskalace_pending["moznosti"]
    pismena = [chr(65 + i) for i in range(len(moznosti))]
    volba_upper = volba.strip().upper()
    if volba_upper not in pismena:
        return False

    flow_run_id = eskalace_pending["flow_run_id"]
    idx = pismena.index(volba_upper)
    vybrana = moznosti[idx]

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{PREFECT_API}/flow-runs/{flow_run_id}/resume",
                json={"keyed_inputs": {"eskalace_odpoved": volba_upper}},
            )
    except Exception as e:
        log.warning(f"Nepodařilo se resumovat flow {flow_run_id}: {e}")

    eskalace_pending = None
    stav = Stav.EXEKUCE
    await send_raw(f"✅ Zvoleno: *{volba_upper}) {vybrana}* — flow pokračuje.")
    return True

# ─── Handler zpráv ────────────────────────────────────────────────────────────

@only_owner
async def zprava(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    global stav, konverzace, cekajici_ukol
    text = update.message.text.strip()

    if stav == Stav.ESKALACE:
        ok = await zpracuj_odpoved_na_eskalaci(text)
        if not ok:
            moznosti = eskalace_pending["moznosti"] if eskalace_pending else []
            pismena = "/".join(chr(65 + i) for i in range(len(moznosti)))
            await update.message.reply_text(f"Odpověz {pismena or 'A/B/C'}.")
        return

    if stav == Stav.EXEKUCE:
        await update.message.reply_text("Agenti pracují. /stav, /log nebo /zrusit")
        return

    if stav in (Stav.PLANUJE, Stav.POC):
        await update.message.reply_text("⏳ Čekám na model...")
        return

    # ── Čekáme na název projektu pro odložený úkol ─────────────────────────
    if stav == Stav.CEKA_NA_PROJEKT:
        await _zpracuj_volbu_projektu(text, update, ctx)
        return

    # ── Klasifikace záměru ─────────────────────────────────────────────────
    zamer = await klasifikuj_zamer(text)

    if zamer == "A":
        # Konverzace — přímá odpověď, nepotřebujeme projekt
        uloz_do_historie("user", text, typ="chat")
        trace = langfuse.trace(name="bot-chat", user_id=str(CHAT_ID),
                               metadata={"projekt": aktivni_projekt}) if langfuse else None
        try:
            gen = trace.generation(name="chat", model=DEFAULT_FAST, input=text) if trace else None
            odpoved = await litellm_chat(
                [{"role": "system", "content": sestav_system_prompt_konverzace()},
                 {"role": "user", "content": text}],
                model=DEFAULT_FAST,
            )
            if gen:
                gen.end(output=odpoved)
            if langfuse:
                langfuse.flush()
            uloz_do_historie("assistant", odpoved, typ="chat")
            # stav zůstává IDLE
            await send(ctx, odpoved)
        except Exception as e:
            if trace:
                trace.update(level="ERROR", status_message=str(e))
                langfuse.flush()
            await send(ctx, f"❌ Chyba: {e}")
        return

    # ── Úkol (B) — zkontroluj projekt ─────────────────────────────────────
    if not aktivni_projekt:
        cekajici_ukol = text
        stav = Stav.CEKA_NA_PROJEKT
        projekty = sorted(p.name for p in PROJECTS_DIR.iterdir() if p.is_dir()) if PROJECTS_DIR.exists() else []
        seznam = "\n".join(f"  • {p}" for p in projekty)
        await update.message.reply_text(
            f"Ke kterému projektu se úkol váže?\n\n{seznam}",
        )
        return

    # ── Úkol (B) — projekt je nastaven, navrhni plán ──────────────────────
    await _navrhni_plan(text, update, ctx)


async def _zpracuj_volbu_projektu(text: str, update, ctx):
    """Zpracuje odpověď uživatele na otázku 'Ke kterému projektu?'"""
    global stav, aktivni_projekt, cekajici_ukol, konverzace
    nazev = text.strip().lower()
    if not (PROJECTS_DIR / nazev).exists():
        projekty = sorted(p.name for p in PROJECTS_DIR.iterdir() if p.is_dir()) if PROJECTS_DIR.exists() else []
        seznam = "\n".join(f"  • {p}" for p in projekty)
        await update.message.reply_text(
            f"Projekt '{nazev}' neexistuje. Vyber ze seznamu:\n\n{seznam}",
        )
        return
    aktivni_projekt = nazev
    ukol = cekajici_ukol
    cekajici_ukol = None
    await update.message.reply_text(f"✅ Projekt nastaven: *{aktivni_projekt}*", parse_mode="Markdown")
    await _navrhni_plan(ukol, update, ctx)


async def _navrhni_plan(text: str, update, ctx):
    """Zavolá planner model, navrhne plán a čeká na /potvrdit."""
    global stav, konverzace
    uloz_do_historie("user", text, typ="task")
    konverzace.append({"role": "user", "content": text})
    stav = Stav.PLANUJE

    await update.message.reply_text("🧠 Přemýšlím...")

    trace = langfuse.trace(name="bot-planning", user_id=str(CHAT_ID),
                           metadata={"projekt": aktivni_projekt}) if langfuse else None

    # Planner dostane jen historii tasků — bez chat konverzací
    historie = nacti_historii(max_zprav=6, pouze_tasky=True)
    zpravy = (
        [{"role": "system", "content": sestav_system_prompt()}]
        + [{"role": m["role"], "content": m["content"]} for m in historie]
        + konverzace
    )

    try:
        gen = trace.generation(name="planning", model=model_override or DEFAULT_PLANNER,
                               input=zpravy) if trace else None
        odpoved = await litellm_chat(zpravy)
        if gen:
            gen.end(output=odpoved)
        if langfuse:
            langfuse.flush()

        konverzace.append({"role": "assistant", "content": odpoved})
        uloz_do_historie("assistant", odpoved, typ="task")
        stav = Stav.DISKUZE
        await send(ctx, odpoved)

    except Exception as e:
        stav = Stav.IDLE
        if trace:
            trace.update(level="ERROR", status_message=str(e))
            langfuse.flush()
        await send(ctx, f"❌ Chyba: {e}")

# ─── Webhook server ───────────────────────────────────────────────────────────

async def webhook_handler(request: web.Request) -> web.Response:
    """
    Přijímá notifikace z Prefect flows.

    Payload:
      { "type": "progress"|"escalation"|"complete"|"error",
        "flow_run_id": "...", "message": "...",
        "options": [...]   # jen pro type=escalation }
    """
    global stav, aktivni_flow_id
    try:
        data = await request.json()
    except Exception:
        return web.Response(status=400, text="Invalid JSON")

    typ         = data.get("type", "progress")
    flow_run_id = data.get("flow_run_id", "")
    message     = data.get("message", "")
    options     = data.get("options", [])

    if typ == "progress":
        await send_raw(f"⏳ [{flow_run_id[:8]}] {message}")
    elif typ == "escalation":
        await eskaluj(flow_run_id, message, options)
    elif typ == "complete":
        stav = Stav.IDLE
        aktivni_flow_id = None
        await send_raw(f"✅ Flow dokončen.\n\n{message}")
    elif typ == "error":
        stav = Stav.IDLE
        aktivni_flow_id = None
        await send_raw(f"❌ Flow skončil chybou.\n\n{message}\n\nPoužij /log pro detail.")

    return web.Response(status=200, text="ok")

async def spust_webhook():
    app = web.Application()
    app.router.add_post("/notify", webhook_handler)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", WEBHOOK_PORT)
    await site.start()
    log.info(f"Webhook server naslouchá na 127.0.0.1:{WEBHOOK_PORT}/notify")

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    global _tg_app

    tg_app = Application.builder().token(BOT_TOKEN).build()
    _tg_app = tg_app

    tg_app.add_handler(CommandHandler("start",    cmd_start))
    tg_app.add_handler(CommandHandler("projekt",  cmd_projekt))
    tg_app.add_handler(CommandHandler("projekty", cmd_projekty))
    tg_app.add_handler(CommandHandler("stav",     cmd_stav))
    tg_app.add_handler(CommandHandler("pamet",    cmd_pamet))
    tg_app.add_handler(CommandHandler("log",      cmd_log))
    tg_app.add_handler(CommandHandler("zrusit",   cmd_zrusit))
    tg_app.add_handler(CommandHandler("potvrdit", cmd_potvrdit))
    tg_app.add_handler(CommandHandler("poc",      cmd_poc))
    tg_app.add_handler(CommandHandler("agenti",   cmd_agenti))
    tg_app.add_handler(CommandHandler("model",    cmd_model))
    tg_app.add_handler(CommandHandler("budget",   cmd_budget))
    tg_app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, zprava))

    async def post_init(app):
        await spust_webhook()

    tg_app.post_init = post_init

    log.info("EVO Bot server spouštím...")
    tg_app.run_polling(drop_pending_updates=True)

if __name__ == "__main__":
    main()
