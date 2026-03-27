# EVO — Instrukce pro Claude Code

> Tento soubor je permanentní kontext pro Claude Code.
> Před každou akcí si ho přečti celý.
> Referenční architektonický dokument: `EVO_architektura.md`

---

## Kdo jsem a co stavím

Jsem Miroslav, neprogramátor. Stavím **EVO** — osobní autonomní AI infrastrukturu na stroji GMKtec EVO-X2 (Ubuntu 24.04, Ryzen AI MAX+ 395, 128 GB unified memory).

Tvoje role je AI vývojář. Píšeš kód, navrhuješ řešení, vysvětluješ co děláš a proč. Já schvaluji, testuji a dávám feedback. Nepíšu kód sám.

---

## Současný stav stacku (co už existuje)

### Na EVO-X2 (`10.10.0.2`)

```
/opt/evostack/                  ← hlavní pracovní složka (Claude Code zde)
  CLAUDE.md                     ← tento soubor
  EVO_architektura.md           ← referenční architektonický dokument
  bot_server.py                 ← přesunuto z /opt/legai
  evo-api/                      ← přesunuto z /opt/evo-api
  docker-compose.yml            ← všechny Docker služby EVO stacku
  .claude/                      ← Claude Code kontext a historie

/data/projects/                 ← projekty s KB a workspace výstupy
/data/knowledge/evo/            ← globální EVO knowledge base
```

**Běžící služby:**
- Ollama (lokální modely: deepseek-r1:32b, qwen2.5:72b, qwen2.5:14b)
- Docker kontejner `evo-api` (FastAPI, port 8000)
- Systemd service `evo-bot` (Telegram bot)

**Existující EVO API endpointy:**
- `GET /api/projects` — seznam projektů
- `GET /api/projects/{p}/knowledge/tree` — KB soubory
- `GET/POST /api/projects/{p}/knowledge/file` — čtení/editace KB
- `GET /api/projects/{p}/outputs` — výstupy agentů
- `GET /api/projects/{p}/tasks/log` — crew_log.txt
- `GET /api/system/stats` — CPU, RAM, GPU, Ollama modely
- `WS /api/chat` — streaming chat

### Na VPS (`10.10.0.1`, `194.182.84.146`)

```
Apache 2.4          ← reverse proxy
Coolify             ← deployment orchestrace
Docker              ← kontejnery
WireGuard           ← VPN (VPS=10.10.0.1, EVO-X2=10.10.0.2, Mac=10.10.0.3)
```

**Existující deployment:**
- `https://hello.parvonic.cz` — EVO Dashboard (Next.js, Coolify)
- Apache proxuje `/api/*` → `10.10.0.2:8000` přes WireGuard

### Dashboard (Next.js)

```
github.com/mparvonic/evo         ← repozitář
/Users/miroslav/Projects/evo-dashboard  ← lokálně na Macu
```

---

## Co budujeme — cílová architektura

Kompletní popis je v `EVO_architektura.md`. Klíčové body:

### Nové komponenty k přidání (v pořadí priority)

**Priorita 1 — Základní AI vrstva**
- [ ] **LiteLLM proxy** — unified interface pro Ollama i cloud API (Anthropic, OpenAI...)
- [ ] **Qdrant** — vektorová DB pro sémantické vyhledávání v KB
- [ ] **LangFuse** — tracing LLM volání, tokeny, náklady (self-hosted)

**Priorita 2 — Autonomní proces**
- [ ] **Prefect** — orchestrace CrewAI jobů, PoC/full flow, retry
- [ ] Self-checking logika v CrewAI agentech (judge model po každém kroku)
- [ ] Eskalační handler v bot_server.py (Telegram notifikace při problému)
- [ ] GitPython — autonomní KB commity s audit trail

**Priorita 3 — Dashboard rozšíření**
- [x] Globální přehled projektů (náklady z LangFuse, aktivní tasky)
- [x] Tasks tab — Prefect flow runs místo raw logu
- [x] Task detail — LangFuse trace viewer
- [x] KB upgrade — Monaco editor, git log, RULES marker, fulltext
- [ ] **Chat oblast** — nová sekce `/dashboard/chats` (viz níže)
- [ ] **PWA** — manifest.json + service worker pro mobilní přístup

**Priorita 4 — Persona management**
- [ ] Persona struktura v KB (`/knowledge/persony/{slug}/`)
- [ ] Persona agenti jako review vrstva (plánování + vyhodnocení, ne exekuce)

**Priorita 5 — Zdroje & Email**
- [ ] Správa zdrojů per task (povinné/doporučené, režimy CLOSED/OPEN/GUIDED)
- [ ] Projektová knihovna zdrojů s digesty
- [ ] Dedikovaná emailová schránka pro EVO (příjem autonomně, odesílání se schválením)

**Priorita 6 — App development workflow**
- [ ] **OpenHands** — coding agent (Docker sandbox na EVO-X2, napojení na LiteLLM)
- [ ] Integrace OpenHands s EVO KB (kontext z KB při každém spuštění)
- [ ] GitHub remote + Coolify auto-deploy workflow
- [ ] OpenHands viewer v Dashboardu

---

## Architektonická pravidla — VŽDY dodržuj

### Infrastruktura
- EVO-X2 = AI/výpočetní vrstva + vývoj + data
- VPS = produkční frontend + backend aplikací + PostgreSQL pro provozní data
- Komunikace EVO-X2 ↔ VPS vždy přes WireGuard (10.10.0.x)
- Všechny nové služby na EVO-X2 jako Docker kontejnery (docker-compose)

### Context management (KRITICKÉ)
- Nikdy nepředávat cloud modelu celou KB nebo celou historii konverzace
- Před každým cloud voláním: Qdrant top-k chunky + kondenzovaná historie
- Kondenzaci vždy provádí lokální qwen2.5:14b — nikdy cloud model
- LangFuse musí logovat přesný počet tokenů každého volání
- Viz sekce "Context management" v `EVO_architektura.md` pro detaily

### Knowledge Base
- KB = git-verzované MD soubory v `/data/projects/{p}/knowledge/`
- Soubory `_RULES.md` a bloky `<!-- IMMUTABLE_START -->` agenti nikdy nepřepisují
- Každá autonomní změna KB = git commit s prefixem `[EVO][task-id]`
- Qdrant je index nad KB, ne náhrada — MD soubory jsou primární zdroj pravdy

### Autonomie a schvalování
- Systém vždy navrhne postup a čeká na `/potvrdit` před exekucí
- PoC run (10 % rozsahu) před plným spuštěním
- Eskalace přes Telegram při: chybě 3×, překročení budget cap, nejednoznačném zadání
- NIKDY autonomně: mazání KB souborů, akce mimo `/data/projects/`, přístup k prod VPS

### Kód a Git
- Repozitáře aplikací: GitHub remote (source of truth) + lokální clone na EVO-X2
- Větve: `main` (prod), `staging`, `dev`, `feature/{x}`
- Uživatel schvaluje merge do `main`
- Coolify webhook: push do `main` = automatický deploy

---

## Jak pracujeme

### Před každou implementací
1. Přečti relevantní část `EVO_architektura.md`
2. Zkontroluj co už existuje (neptej se, podívej se do souborů)
3. Navrhni přístup a čekej na souhlas, pokud jde o větší změnu
4. Pro malé změny (< 50 řádků) implementuj rovnou a pak vysvětli

### Při implementaci
- Piš produkční kód, ne jen ukázky
- Každý nový Docker kontejner = vlastní `docker-compose.yml` sekce
- Každá nová závislost = zdůvodnění proč
- Pokud narážíš na problém, popiš ho a navrhni alternativy — neblokuj se

### Komunikace
- Mluv česky
- Buď konkrétní — místo "můžeme přidat X" řekni "přidám X do souboru Y na řádku Z"
- Pokud něčemu nerozumím, vysvětli to bez jargonu nebo s analogií
- Ukazuj výsledky, ne jen kód — spusť a ověř že to funguje

### Čeho se vyvarovat
- Nepředpokládej že vím co je co — vysvětli kontext
- Neměň architekturu bez diskuze (přidávat je ok, přepisovat existující ne)
- Nepouštěj destruktivní operace bez explicitního souhlasu
- Nepřepisuj `_RULES.md` ani IMMUTABLE bloky v KB

---

## Rychlá reference — klíčové cesty

```
EVO-X2:
  /opt/evostack/               ← hlavní pracovní složka
  /opt/evostack/bot_server.py  ← Telegram bot (notifikace + quick akce)
  /opt/evostack/evo-api/       ← FastAPI
  /data/projects/              ← projekty s KB a workspace
  /data/chats/workspace/       ← NOVÉ: sdílený workspace chatů
  /data/knowledge/             ← globální KB

Mac (záloha / přístup):
  /Users/miroslav/Projects/legAI        ← původní složka (zachovat)
  /Users/miroslav/Projects/evo-dashboard ← Next.js dashboard

Síť:
  EVO-X2:    10.10.0.2
  VPS:       10.10.0.1
  Mac:       10.10.0.3
  Dashboard: https://hello.parvonic.cz (PWA — instalovatelný na mobil)
  EVO API:   http://10.10.0.2:8000
```

---

## Dashboard — oblasti

```
/dashboard                    ← globální přehled (projekty + chaty + náklady)
/dashboard/chats              ← seznam chatů (jako Claude.ai)
/dashboard/chats/{id}         ← detail chatu (konverzace / výstupy / tasky)
/dashboard/project/{p}        ← detail projektu
/dashboard/project/{p}/task/{id} ← LangFuse trace viewer
```

**Telegram = notifikační vrstva** — push, eskalace, rychlé příkazy  
**Dashboard PWA = primární UI** — chaty, projekty, KB, výstupy, persony

### Chat oblast — klíčové vlastnosti
- Každý chat = samostatná konverzace s historií (jako Claude.ai)
- Multi-persona: více hlasů v jednom chatu, max 2 kola reakcí + syntéza
- Workspace: `/data/chats/workspace/{chat-id}/` — MD soubory, obrázky, zdroje
- Z detailu chatu vidíš jen výstupy daného chatu
- LangFuse trace i pro volné chaty (tokeny, čas)

### PWA požadavky (Next.js)
- `public/manifest.json` — název, ikony, barvy
- `app/service-worker.js` — offline cache, push notifikace
- Web Push API — iOS 16.4+, Android bez omezení

---

## Kde začít

Pokud nevíš kde začít nebo jsi právě spuštěn poprvé:

1. Přečti `EVO_architektura.md` — kompletní technický popis
2. Zkontroluj aktuální stav: `docker ps`, stav Ollama, existující API endpointy
3. Zeptej se na první prioritu nebo čekej na zadání

---

*Tento soubor udržuj aktuální — po každé větší změně stacku ho uprav.*
