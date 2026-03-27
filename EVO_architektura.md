# EVO — Architektura, koncept a implementační záměr

> Stav: 2026-03-27  
> Autor: Miroslav Parvonic  
> Cíl: Autonomní AI infrastruktura pro tvorbu dokumentů a vývoj aplikací

---

## 1. Základní filozofie

EVO je osobní AI infrastruktura postavená na principu **"Lazy Human in the Loop"**:

- Člověk vstupuje pouze v rozhodovacích bodech, ne při exekuci
- Systém sám detekuje, kdy potřebuje potvrzení vs. kdy může pokračovat autonomně
- Každá autonomní akce zanechá auditovatelnou stopu
- Žádná nevratná akce bez explicitního souhlasu

### Primární use cases

1. **Tvorba dokumentů** — analytické studie, výzkumné zprávy, datové analýzy, grafy, schémata, infografiky
2. **Vývoj aplikací** — jako neprogramátor, od konceptu po produkci, s AI jako primárním vývojářem

---

## 2. Hardware a síťová infrastruktura

### EVO-X2 (lokální AI stroj)

| Parametr | Hodnota |
|---|---|
| CPU | AMD Ryzen AI MAX+ 395, 32 jader |
| Paměť | 128 GB unified memory (CPU+GPU sdílí fyzický pool) |
| Systémová RAM | ~62 GB viditelná OS |
| GPU paměť | ~64 GB (BIOS UMA Frame Buffer Size) |
| Ollama přístup | celých 128 GB přes unified memory |
| Úložiště | 2 TB NVMe (`/data`) |
| OS | Ubuntu 24.04 |
| IP (WireGuard) | 10.10.0.2 |

**Role EVO-X2:**
- Hosting lokálních AI modelů (Ollama)
- Primární datové úložiště (knowledge base, projekty, AI výstupy)
- Vývojové prostředí pro aplikace (prototypování, vývoj)
- Exekuce AI agentů a workflow

### VPS (194.182.84.146)

| Parametr | Hodnota |
|---|---|
| OS | Debian 12 |
| Stack | Docker, Apache 2.4, Coolify |
| IP (WireGuard) | 10.10.0.1 |
| Doména | hello.parvonic.cz |

**Role VPS:**
- Hosting frontendů produkčních aplikací
- Hosting backendů produkčních aplikací
- Reverse proxy (Apache) pro EVO API přes WireGuard
- CI/CD deployment (Coolify z git repozitářů)

### Síť (WireGuard VPN)

```
VPS       10.10.0.1
EVO-X2    10.10.0.2
Mac       10.10.0.3
```

### Datová architektura

```
EVO-X2 /data/
  projects/{projekt}/
    knowledge/          ← KB projektu (git-verzovaná)
    envs/proto/workspace/  ← výstupy agentů
  knowledge/evo/        ← globální EVO KB

VPS (produkční aplikace):
  PostgreSQL            ← provozní data aplikací
  ← EVO-X2 pouze jako AI/analytická vrstva, ne prod DB
```

> **Důležité:** EVO-X2 musí být dostupný 24/7 pro produkční AI funkce. Provozní data aplikací jsou na VPS v PostgreSQL — odděleno od AI vrstvy.

---

## 3. AI modely

### Lokální modely (Ollama na EVO-X2)

| Model | Role | Tool calling | Paměť |
|---|---|---|---|
| deepseek-r1:32b | Plánování, reasoning, replanning | ❌ | ~107 GB |
| qwen2.5:72b | Exekuce agentů, tool calling | ✅ | velký |
| qwen2.5:14b | Rychlá komunikace, Telegram, klasifikace | ✅ | střední |

### Cloud modely (přes API)

Připojeny přes **LiteLLM proxy** jako unified interface — kód agentů neví, jestli volá lokální nebo cloud model.

| Provider | Modely | Typické použití |
|---|---|---|
| Anthropic | Claude Opus/Sonnet | Složitý kontext, dlouhé dokumenty, multimodal |
| OpenAI | GPT-4o, o1 | Alternativa, code generation |
| Google | Gemini Pro | Velmi dlouhý kontext |
| (další) | dle potřeby | — |

### Routing logika — lokální vs. cloud

```
Klasifikace úkolu (qwen2.5:14b)
  ↓
Jednoduchý / rychlý → lokální qwen2.5:14b
Reasoning / plánování → deepseek-r1:32b (lokální)
Agent s tool calling → qwen2.5:72b (lokální)
Složitý kontext / multimodal / velký dokument → cloud (Claude/GPT)
Manuální override → Telegram příkaz /model <nazev>
Budget cap překročen → eskalace, čeká na souhlas
```

### Token tracking a náklady

Vše zachyceno přes **LangFuse** (self-hosted):
- Cloud modely: tokeny + náklady v USD per projekt/task/agent
- Lokální modely: tokeny + čas/compute (ekvivalentní náklady)
- Budget cap per projekt — při překročení eskalace přes Telegram
- Dashboard: přehled spotřeby v reálném čase

### Context management — optimalizace tokenového toku

> ⚠️ **Kritická vrstva.** LiteLLM routing sám o sobě kontext nekomprimuje ani neoptimalizuje — co přijde na vstup, to přepošle dál. Bez explicitního context managementu jsou náklady na cloud modely nepředvídatelné.

Context management je samostatná vrstva mezi KB/historií a voláním modelu. Sedí před každým LiteLLM voláním a zodpovídá za to, co model skutečně dostane.

#### Problém bez context managementu

```
❌ Naivní přístup:
   Celá konverzační historie (50k tokenů)
   + všechny relevantní KB soubory (30k tokenů)
   + výsledky tool calls (20k tokenů)
   ──────────────────────────────────────
   = 100k tokenů × cena cloud modelu = nečekaný účet
```

#### Čtyři mechanismy optimalizace

**1. RAG místo plného KB kontextu**

Qdrant vrátí pouze nejrelevantnější chunky místo celých souborů:

```
❌ Špatně: předat cloud modelu celý KB projekt (desítky MD souborů)
✅ Správně: Qdrant sémanticky vyhledá top-5 nejrelevantnějších chunků
           → typicky 2–4k tokenů místo 30–50k
```

**2. Kondenzace konverzační historie**

Místo rostoucí historie agentní konverzace se průběžně generuje shrnutí:

```python
# Konceptuálně — context condenser
if len(conversation_history) > TOKEN_THRESHOLD:
    summary = summarize(conversation_history, model="qwen2.5:14b")
    # Levný lokální model kondenzuje, cloud dostane jen shrnutí
    conversation_history = [summary]
```

OpenHands má `LLMSummarizingCondenser` nativně.  
Pro CrewAI flows implementovat jako wrapper před každým cloud voláním.

**3. Structured context packing**

Standardizovaný payload pro cloud volání — přesně definuje co se posílá:

```python
cloud_context = {
    "task_summary":      "...",   # ~500 tokenů — co a proč
    "kb_chunks":         [...],   # ~2–4k tokenů — Qdrant top-k
    "previous_steps":    "...",   # ~1–2k tokenů — kondenzovaná historie
    "current_instruction": "...", # ~500 tokenů — aktuální krok
    "constraints":       "...",   # ~200 tokenů — neměnná pravidla
}
# Celkem: ~5–7k tokenů místo 100k+
```

**4. Model-aware sizing**

Různé cloud modely mají různé cenové struktury vstupních tokenů. LiteLLM umožní nastavit per-model limity — pokud payload přesáhne limit, context builder dále komprimuje nebo eskaluje.

```yaml
# LiteLLM konfigurace (konceptuálně)
model_limits:
  claude-opus:   max_input_tokens: 8000   # drahý, striktní limit
  claude-sonnet: max_input_tokens: 20000  # střední
  gpt-4o:        max_input_tokens: 15000
  gemini-pro:    max_input_tokens: 50000  # dlouhý kontext, levnější
```

#### Celkový tok s context managementem

```
KB soubory (plné MD soubory v gitu)
     ↓
Qdrant → sémantické vyhledávání → top-k chunky
     ↓
Context Builder:
  ├── RAG chunky z Qdrantu
  ├── Kondenzovaná historie agenta (lokální model)
  ├── Task instrukce + constraints
  └── Model-aware sizing (limit per provider)
     ↓
LiteLLM → správný provider (cloud nebo lokální)
     ↓
LangFuse → loguje přesný počet odeslaných tokenů, náklady, model
     ↓
Response → agent pokračuje
```

#### Kde kondenzaci provádět — vždy lokálním modelem

Kondenzace a shrnutí kontextu před cloud voláním probíhá vždy na **qwen2.5:14b lokálně** — je to rychlé, levné a výsledek (shrnutí) pak putuje do drahého cloud modelu. Nikdy nekondenzovat cloud modelem — to by zdvojilo náklady.

```
Lokální model (qwen2.5:14b):  kondenzuje historii  → zdarma
Cloud model (Claude/GPT):     dostane kondenzát    → placeno, ale 10× méně tokenů
```

---

## 4. Autonomní proces — životní cyklus tasku

### Přehled fází

```
[1] Příjem záměru        → chat (Telegram / Dashboard)
[2] Design procesu       → EVO navrhne postup, čeká na souhlas
[3] Proof of Concept     → mini-run (10 % rozsahu), potvrzení
[4] Plná exekuce         → autonomní, s průběžným self-checkingem
[5] Self-recovery        → retry / replan / eskalace
[6] Výstup + KB update   → uložení, git commit, shrnutí
```

---

### Fáze 1 — Příjem záměru

Uživatel zadá záměr přirozeným jazykem přes Telegram nebo Dashboard chat.

**qwen2.5:14b** provede klasifikaci:
- Typ úkolu (discovery / analýza / vývoj / dokument)
- Projekt kontext
- Odhadovaná složitost → volba modelů
- Co již existuje v KB → nevytváří znovu hotové

---

### Fáze 2 — Design procesu (ze zastání)

EVO **nezačne rovnou dělat** — navrhne postup a čeká:

```
EVO → Telegram:

"📋 Navrhovaný postup:
 1. Prohledat KB [legai/technicka] — co už víme
 2. Web search: Riigikogu amendment procedures
 3. Analýza: porovnat s českou úpravou (dle ADR-003)
 4. Výstup: markdown report + 3 hypotézy do KB

 Modely: deepseek-r1 (plán) + qwen2.5:72b (exekuce)
 Odhadovaný čas: 15 min | Cloud tokeny: ~0 USD
 Riziko: estonské zdroje mohou být v estonštině

 Navrhovaní agenti: [Průzkumník] [Analytik] [Syntetizátor]
 Upravit sestavu? /agenti

 /potvrdit | /upravit | /zrušit"
```

Uživatel může před potvrzením upravit sestavu agentů (přidat / odebrat).

---

### Fáze 3 — Proof of Concept

Pro každý netriviální úkol EVO spustí **mini-run**:

```
Plný plán:  5 agentů, 3 zdroje, 45 min
              ↓
PoC run:    1 agent, 1 zdroj, ~5 min
              ↓
EVO hlásí:  "✅ PoC hotov.
             Nalezeno: 12 relevantních dokumentů
             Kvalita dat: dobrá
             Žádná blocker situace detekována

             Pokračovat v plné analýze? /potvrdit | /zrušit"
```

> Zabrání 45minutové práci na špatně postaveném zadání.

**Nástroj:** Prefect — PoC jako separátní flow s parametrem `mode=probe`

---

### Fáze 4 — Autonomní exekuce se self-checkingem

Po každém kroku agenti provádí self-evaluaci (qwen2.5:14b jako judge):

```python
def after_each_step(result, plan):
    quality = evaluate_result(result)  # judge model

    if quality == "ok":
        continue_to_next_step()

    elif quality == "degraded":
        retry_with_different_approach()  # max 2x, pak eskalace

    elif quality == "off_track":
        replan_remaining_steps()        # deepseek-r1 přeplánuje zbytek

    elif quality == "blocked":
        escalate_to_human()             # Telegram + čeká
```

---

### Fáze 5 — Detekce a oprava chyb

Tři úrovně self-recovery:

| Úroveň | Situace | Akce |
|---|---|---|
| **Retry** | Timeout, síťová chyba, prázdný výsledek | Znovu s jiným promptem, max 3× |
| **Replan** | Agent uvízl, výsledky mimo téma | deepseek-r1 přeplánuje zbývající kroky |
| **Eskalace** | Opakovaný neúspěch, chybí data, nejednoznačné zadání | Telegram notifikace, čeká na člověka |

Příklad eskalační zprávy:
```
⚠️ Uvízl jsem na kroku 3/5.
Agent nenašel estonské právní texty v češtině.

Možnosti:
A) Přejít na anglické zdroje
B) Přeskočit komparaci, dodat jen český popis
C) Zastavit úkol

Odpověz A, B nebo C
```

**Nástroje:** Prefect retry policies, Tenacity (Python), vlastní `escalation_handler`

---

### Fáze 6 — Výstup a knowledge update

Po dokončení EVO automaticky:

1. Uloží report → `/data/projects/{p}/workspace/`
2. Extrahuje poznatky → aktualizuje relevantní KB soubory
3. Vytvoří/aktualizuje hypotézy (aktivni/ nebo potvrzene/)
4. Loguje do LangFuse (tokeny, čas, kvalita, náklady)
5. Commitne KB změny do gitu s popisným commit message
6. Odešle shrnutí přes Telegram

---

### Nepřekročitelné hranice (vždy eskaluje)

Tato pravidla jsou zakódována v systémovém promptu všech agentů a nemohou být přepsána:

```
VŽDY eskaluje — NIKDY nejedná autonomně:
  - Mazání nebo přepisování existujících KB souborů
  - Jakákoli akce mimo /data/projects/ (filesystem boundary)
  - Úkol překročí odhadovaný čas 2×
  - Nalezena konfliktní informace s existující KB
  - Nejasné zadání (confidence < threshold)
  - Překročení budget cap pro cloud tokeny
  - Přístup k produkčnímu prostředí (VPS)
```

---

## 5. Knowledge Base

### Struktura (wiki-style MD soubory)

```
/data/projects/{projekt}/knowledge/
  _PROJECT.md           ← iniciační soubor projektu (viz sekce 7)
  _RULES.md             ← neměnná pravidla projektu
  technicka/            ← technické detaily, datové zdroje
  aplikacni/            ← use cases, aplikační logika
  business/             ← business kontext
  persony/              ← katalog person (viz sekce 8)
    {persona}/
      profil.md
      use-cases.md
  rozhodnuti/           ← ADR (Architecture Decision Records)
  hypotezy/
    aktivni/
    potvrzene/
    zamitnute/
  scenare/
    kandidati/
    hodnoceni/
    prioritizovane/
  experimenty/
  integrace/
  procesni/
```

### Neměnná pravidla

Dvě varianty označení:

**Varianta A — samostatný soubor `_RULES.md`:**
```markdown
# Neměnná pravidla projektu

> ⚠️ Tento soubor smí být měněn POUZE člověkem. Agenti jej čtou, nikdy nepíší.

## RULE-001: ...
## RULE-002: ...
```

**Varianta B — blok v libovolném MD souboru:**
```markdown
<!-- IMMUTABLE_START -->
Tento blok je neměnný. Agenti jej nesmí modifikovat.
<!-- IMMUTABLE_END -->
```

Agenti mají v systémovém promptu instrukci respektovat obě varianty.

### Verzování a změnová historie

- Celá KB je **git repozitář** na EVO-X2
- Každá autonomní změna = commit s popisem: `[EVO][task-id] Aktualizace hypotéz po analýze estonského systému`
- Manuální editace = commit bez prefixu
- Dashboard zobrazuje git log per soubor → full change history

### Přístup agentů ke KB

```
Sémantické vyhledávání → Qdrant (vektorový index nad KB soubory)
Přímé čtení souboru    → filesystem (pro strukturované načítání)
Zápis                  → POUZE přes definované write funkce (s logovaniem)
```

---

## 6. Dashboard architektura

Jeden Next.js projekt, více pohledů. Auth: NextAuth.js.
**Progressive Web App (PWA)** — instalovatelný na mobil jako nativní aplikace, push notifikace přes Web Push API.

### Dvě hlavní oblasti

```
EVO Dashboard
  ├── CHATY     ← volné konverzace, multi-persona, workspace výstupy
  └── PROJEKTY  ← strukturovaná práce s KB, agenty, Prefect flows
```

---

### Oblast 1 — Chaty (`/dashboard/chats`)

Volné konverzace bez nutnosti vazby na projekt. Inspirace: Claude.ai — každý chat je samostatná konverzace s historií, lze se vracet.

#### Seznam chatů (`/dashboard/chats`)
- Chronologický seznam všech chatů
- Název chatu (generovaný z prvního dotazu nebo manuální)
- Datum, počet zpráv, počet výstupů
- Tlačítko: **Nový chat**

#### Detail chatu (`/dashboard/chats/{id}`)

```
┌─ CHAT: "Analýza estonského legislativního systému" ────────┐
│                                                             │
│ [Uživatel] Jak estonský systém řeší pozměňovací návrhy?    │
│                                                             │
│ [EVO] Text odpovědi...                                      │
│       [💾 Uložit jako MD] [📎 Zdroj použit: URL]           │
│                                                             │
│ [Uživatel] A co právní závaznost konsolidovaného textu?    │
│ ...                                                         │
└─────────────────────────────────────────────────────────────┘

Záložky:
  Konverzace | Výstupy | Tasky
```

**Záložka Výstupy** — soubory uložené z tohoto chatu do sdíleného workspace:
```
/data/chats/workspace/
  {chat-id}/
    poznamky_estonsko.md
    screenshot_riigi_teataja.png
```

Workspace je sdílený přes všechny chaty, ale z detailu chatu vidíš jen výstupy tohoto chatu.

**Záložka Tasky** — přehled LangFuse traces pro tento chat (i volný chat loguje tokeny a čas).

#### Persony v chatu

Uživatel může aktivovat více person pro jeden chat:

```
Uživatel: "Diskutuj o tom jako právník a jako IT architekt"

⚖️ Právník: [pohled z právní perspektivy]

🏗️ IT architekt: [pohled z technické perspektivy]

⚖️ Právník (reakce): [reakce na IT pohled]

─── Syntéza ───────────────────────────────
📝 EVO: [souhrnný pohled kombinující oba úhly]
```

**Pravidla person:**
- Max 2 kola vzájemných reakcí (4–6 zpráv), pak povinná syntéza
- Persony definovány v katalogu (`/data/knowledge/persony/`) nebo ad-hoc v chatu
- Tokeny per-persona sledovány odděleně v LangFuse

---

### Oblast 2 — Projekty (`/dashboard/projects`)

#### Globální přehled (`/dashboard`)
- Přehled všech projektů (název, stav, poslední aktivita)
- Přehled chatů (poslední aktivita)
- Tlačítko: **Nový projekt** → průvodce
- Status bar EVO-X2: CPU, RAM, GPU, aktivní modely, Ollama
- Přehled cloudových nákladů (dnes / tento měsíc, per projekt + chaty)
- Přehled běžících tasků napříč projekty

#### Detail projektu (`/dashboard/project/{p}`)

Záložky:

| Záložka | Obsah |
|---|---|
| **Přehled** | Stav projektu, aktivní tasky, poslední výstupy |
| **Tasky** | Běžící + historické tasky (viz pohled 3) |
| **Výstupy** | Markdown soubory z workspace, souhrny tasků |
| **Knowledge Base** | Prohlížeč + editor KB (viz pohled 4) |
| **Agenti** | Správa definic agentů projektu |
| **Persony** | Katalog person + use cases |

#### Detail tasku (`/dashboard/project/{p}/task/{id}`)

```
Task: "Analýza estonského systému pozměňovacích návrhů"
Status: DOKONČEN | Čas: 18 min | Tokeny: 42k local / 8k cloud (0.12 USD)

┌─ PLÁN ─────────────────────────────────────────────────────┐
│ Krok 1: KB lookup [DONE] | Krok 2: Web search [DONE] | ... │
└─────────────────────────────────────────────────────────────┘

┌─ AGENT: Průzkumník ────────────────────────────────────────┐
│ PROMPT / RESPONSE / TOOL CALLS                              │
└─────────────────────────────────────────────────────────────┘

┌─ SOUHRN TASKU ─────────────────────────────────────────────┐
│ [generovaný souhrn] | Výstupy: [odkazy]                     │
└─────────────────────────────────────────────────────────────┘
```

**Nástroj:** LangFuse zachytí vše, Dashboard čte přes LangFuse API

#### KB prohlížeč/editor

- Stromová navigace adresářové struktury KB
- Inline MD editor (Monaco editor)
- Git log per soubor (kdo/co změnil)
- Označení `_RULES.md` souborů speciální ikonou 🔒
- Vizuální zvýraznění IMMUTABLE bloků (nelze editovat v UI)
- Fulltext search přes KB soubory

---

### PWA — mobilní přístup

Dashboard je Progressive Web App — instalovatelný na plochu mobilu:
- `manifest.json` + service worker v Next.js
- Fullscreen bez browser chrome
- Web Push notifikace (iOS 16.4+, Android bez omezení)
- Offline cache pro čtení chatů a KB

**Telegram zůstává jako notifikační vrstva:**
- Push notifikace (task dokončen, eskalace, budget alert)
- Rychlé příkazy (`/projekt`, `/potvrdit`, `/budget`)
- Jednoduchý vstup bez nutnosti otevřít Dashboard

---

## 7. Správa projektů a iniciační dokument

### Nový projekt — průvodce

1. Název projektu + slug (identifikátor)
2. Typ projektu: `dokument` | `aplikace` | `výzkum` | `hybrid`
3. Popis záměru (volný text → AI z něj vygeneruje draft `_PROJECT.md`)
4. Uživatel zkontroluje a upraví → uloží
5. EVO vytvoří adresářovou strukturu, inicializuje git repozitář

### `_PROJECT.md` — iniciační soubor projektu

```markdown
# {Název projektu}

## Záměr
[Stručný popis co projekt řeší a proč]

## Očekávané výstupy
- [výstup 1]
- [výstup 2]

## Procesy
[Jak se na projektu pracuje, milníky, způsob verifikace]

## Technický kontext
[Stack, datové zdroje, integrace]

## Úspěch vypadá takto
[Konkrétní kritéria dokončení]
```

---

## 8. Katalog person a persona agenti

### Struktura persony

Každá persona = adresář v KB:

```
/knowledge/persony/{slug}/
  profil.md       ← kdo je, kontext, motivace
  use-cases.md    ← businessové potřeby v kontextu projektu
  agent.yaml      ← definice persona agenta
```

### `profil.md` — šablona

```markdown
# Persona: {Jméno}

## Profil
[Kdo je, role, kontext]

## Motivace a cíle
[Co chce dosáhnout]

## Frustrace a bolestivá místa
[Co mu/jí nefunguje, co jej/ji obtěžuje]

## Technická zdatnost
[Jak pracuje s technologiemi]
```

### `use-cases.md` — businessové use cases persony

```markdown
# Use Cases: {Jméno} × {Projekt}

## UC-001: {Název}
**Potřeba:** ...
**Aktuální stav:** ...
**Očekávané řešení:** ...
**Priorita:** Vysoká / Střední / Nízká
**Akceptační kritéria:** ...
```

### Persona agent — role

Persona agent **není součástí exekuční crew**. Vstupuje ve dvou fázích:

**Fáze plánování** (před /potvrdit):
- Projde navrhovaný plán optikou své persony
- Upozorní na chybějící use cases nebo špatné priority
- Výstup: "Z pohledu {persony} v plánu chybí X / je přeceněno Y"

**Fáze vyhodnocení** (po dokončení tasku):
- Projde výstupy optikou své persony
- Generuje zpětnou vazbu ke kvalitě a úplnosti
- Jeho hodnocení vstupuje do KB jako součást výsledků

**Fáze exekuce** — persona agent **nepůsobí**, nevstupuje do průběhu.

---

## 9. Správa zdrojů

### Zdroje na úrovni tasku

Při každém zadání může uživatel specifikovat zdroje:

```
Povinné zdroje:    musí být použity, agent hlásí pokud je nenajde
Doporučené zdroje: preferovány, ale neblokující
Zakázané zdroje:   agent nesmí použít

Režim práce se zdroji:
  CLOSED  → pouze definovaná množina zdrojů, nic dalšího
  OPEN    → definované zdroje + cokoliv dalšího dostupného
  GUIDED  → definované zdroje prioritně, další jen pokud nestačí
```

Příklad zadání v chatu:
```
"Analyzuj dopad GDPR na náš systém.
 Povinné: [link na _PROJECT.md] [link na text GDPR]
 Doporučené: [link na EDPB guidelines]
 Režim: GUIDED"
```

### Přehled zdrojů per task

Každý task automaticky generuje `sources.md` ve workspace:

```markdown
# Zdroje tasku: {název}

## Použité zdroje
| Zdroj | Typ | Povinný | Relevance | Poznámka |
|---|---|---|---|---|
| KB: technicka/gdpr_analyza.md | KB soubor | ✅ | Vysoká | Základ analýzy |
| https://eur-lex.europa.eu/... | Web | ✅ | Vysoká | Oficiální text GDPR |
| https://edpb.europa.eu/... | Web | Doporučený | Střední | Guidelines k čl. 6 |

## Nenalezené povinné zdroje
(prázdné)

## Zdroje nalezené agentem nad rámec zadání
| Zdroj | Proč přidán |
|---|---|
| https://... | Relevantní judikatura SDEU |
```

### Projektová knihovna zdrojů

Hodnotné zdroje se sdílejí na úrovni projektu jako strukturovaná knihovna:

```
/data/projects/{p}/knowledge/zdroje/
  _registry.md          ← index všech zdrojů projektu + hodnocení
  web/{slug}.md         ← digest webového zdroje
  dokumenty/{slug}.md   ← digest dokumentu
  datove-sady/{slug}.md ← popis a přístup k datové sadě
```

Digest = strukturovaný výtah klíčových informací ze zdroje, ne plný obsah.

Po každém tasku agent:
1. Vyhodnotí použité zdroje (kvalita, relevance, opakovatelnost)
2. Navrhne přidání hodnotných zdrojů do projektové knihovny
3. Pokud zdroj již existuje, aktualizuje digest o nové poznatky
4. Commitne do gitu

### Placené zdroje — schvalovací proces

Pokud agent narazí na placený obsah:

```
EVO → Telegram:
"💳 Nalezen zajímavý placený zdroj:

 Název: Comparative Law Database
 URL: https://...
 Cena: ~2 USD jednorázový přístup
 Relevance: Vysoká — estonská legislativa v AJ
 Alternativa: nenalezena

 Pokud chceš přistoupit, proveď platbu jednorázovou kartou,
 pak mi pošli username nebo přímý odkaz na obsah.

 /preskocit — pokračovat bez tohoto zdroje"
```

Agent **nikdy** nečeká pasivně — vždy nabídne `/preskocit` a pokračuje.
Agent **nikdy** nežádá o platební údaje — uživatel platí sám.

---

## 10. Autonomní práce s online službami a emailem

### Dedikovaná emailová schránka

EVO má vlastní emailovou adresu (např. `evo@parvonic.cz`).

| Akce | Povoleno |
|---|---|
| Přijímat emaily | ✅ autonomně |
| Číst příchozí emaily, extrahovat informace | ✅ autonomně |
| Registrovat se do online služeb touto adresou | ✅ autonomně |
| Odesílat emaily | ❌ pouze se schválením |
| Přistupovat k osobním schránkám uživatele | ❌ nikdy |

### Registrace do online služeb

Agent může autonomně projít celým registračním flow:
1. Navštívit registrační stránku
2. Vyplnit formulář (jméno: EVO / Miroslav Parvonic, email: evo@...)
3. Přijmout a zpracovat potvrzovací email
4. Dokončit registraci
5. Uložit přístupové údaje (bez hesla) do KB projektu

Agent **nesmí** autonomně:
- Zadávat platební údaje (ani "free trial" s kartou)
- Souhlasit s placeným plánem
- Registrovat se jako fyzická osoba tam, kde to není vhodné

### Odesílání emailů — schvalovací proces

```
EVO → Telegram:
"📧 Potřebuji odeslat email:

 Komu: info@riigikantselei.ee
 Předmět: Request for legislative data access
 ─────────────────────────────────────────
 Dear Sir/Madam,
 I am researching comparative legislative systems...
 [plný návrh emailu]
 ─────────────────────────────────────────

 /odeslat | /upravit | /zrušit"
```

EVO email neodešle bez výslovného `/odeslat`. Uživatel může text před odesláním upravit.

### Autonomní web browsing

Agent může autonomně:
- Procházet veřejně dostupné weby a stahovat volně dostupné dokumenty
- Vyplňovat a odesílat formuláře (kontaktní, registrační)
- Přihlašovat se ke službám kde má přístupové údaje

Vše je logováno v task detailu (audit log akcí agenta).

---

## 11. Správa AI agentů

### Definice agenta (YAML soubor v KB)

```yaml
# /knowledge/agenti/{slug}.yaml

id: analytik-legislativa
name: Analytik legislativy
role: Provádí hloubkovou analýzu legislativních dokumentů
goal: Identifikovat strukturální vzory, nesoulady a příležitosti ke zlepšení
backstory: |
  Specializovaný analytik s hlubokými znalostmi českého a komparativního práva.
  Pracuje systematicky, cituje zdroje, rozlišuje fakta od interpretací.

model: qwen2.5:72b  # nebo "auto" pro routing
tools:
  - qdrant_search
  - web_search
  - file_read
  - file_write

constraints:
  - Nikdy nevytváří právní závěry bez citace zdroje
  - Vždy označí nejistotu slovy "pravděpodobně" / "nelze ověřit"

output_format: markdown
```

### Správa agentů v Dashboardu

- Přehled všech agentů projektu (seznam z YAML souborů)
- Inline editor definice agenta
- Tlačítko: **Nový agent** → AI navrhne definici na základě popisu
- Historie změn agenta (git log YAML souboru)

### Výběr agentů před taskem

```
EVO navrhne: [Průzkumník] [Analytik] [Syntetizátor]

Uživatel může:
  + přidat agenta ze seznamu dostupných
  - odebrat navrhovaného
  ✏️ upravit parametry agenta pro tento task
  ✅ potvrdit sestavu → spustit
```

---

## 12. Vývoj aplikací (neprogramátor)

### Klíčový nástroj: OpenHands

**OpenHands** (dříve OpenDevin) je primární coding agent pro vývoj aplikací v EVO. Jde o open-source platformu (MIT licence, 68k+ GitHub hvězd, aktivně vyvíjená), která funguje jako autonomní AI softwarový inženýr — edituje soubory, spouští příkazy v terminálu, prochází web, volá API a řeší víceúrovňové vývojové úkoly end-to-end.

**Proč OpenHands:**
- Model-agnostic — funguje s Ollama (lokální modely) i cloud API přes LiteLLM
- Interní LiteLLM routing → stejný interface jako zbytek EVO stacku
- Docker sandbox → kód se spouští izolovaně na EVO-X2
- Human-in-the-loop UI — vidíš co agent dělá, můžeš kdykoli vstoupit
- REST API + Python SDK → integrovatelný do EVO API a Dashboardu

**Kritická synergie s EVO KB:**  
OpenHands sám o sobě nemá projektovou paměť — každá session začíná od nuly. Tvoje git-verzovaná KB tento problém řeší: OpenHands dostane při každém spuštění kontext z KB (`_PROJECT.md`, technické dokumenty, ADR rozhodnutí, coding conventions). Kombinace OpenHands + EVO KB = agent který zná projekt.

---

### Vývojový životní cyklus

```
[1] Concept & Plan   → chat s AI, _PROJECT.md, wireframe popis
[2] Prototyp         → klikatelné React obrazovky s mock daty
[3] Vývoj            → OpenHands píše kód, git větve, code review
[4] Testování        → na VPS (staging), manuální + AI testy
[5] Produkce         → deploy na VPS přes Coolify
```

### Fáze 1 — Concept & Plan

- Chat s AI (Telegram / Dashboard)
- AI pomůže strukturovat `_PROJECT.md`
- Výstup: uživatelské příběhy, technický stack, milníky
- AI navrhne adresářovou strukturu projektu a KB

### Fáze 2 — Rychlé prototypování

- OpenHands generuje React mockupy s mock daty
- Klikatelné obrazovky — navigace, formuláře, základní UX flow
- Hosting prototypu na EVO-X2 (lokálně dostupný přes prohlížeč)
- Iterace: feedback → OpenHands upraví → nový prototyp
- **Žádný reálný backend** — vše statické s fake daty

### Fáze 3 — Vývoj

**Stack aplikací:**
- Frontend: Next.js / React
- Backend: FastAPI (Python) nebo Next.js API routes
- DB: PostgreSQL na VPS (provozní data)
- AI/data vrstva: EVO-X2 (přes WireGuard)

**Git workflow:**
```
main          ← produkce (chráněná větev, GitHub)
staging       ← testování (GitHub)
dev           ← aktivní vývoj (GitHub)
feature/{x}   ← jednotlivé featury (GitHub)
```

**Repozitáře:**
- **GitHub** = remote origin, source of truth pro produkci
- **EVO-X2** = lokální vývojové prostředí (git clone z GitHub)
- **OpenHands** generuje kód na EVO-X2 v Docker sandboxu, pushuje na GitHub
- **Coolify** sleduje GitHub webhook → push do `main` = automatický deploy na VPS

**Kontext OpenHands při každém spuštění:**
```
Systémový kontext (z KB projektu):
  - _PROJECT.md          ← záměr, výstupy, stack
  - rozhodnuti/*.md      ← ADR — proč je co jak uděláno
  - technicka/*.md       ← technické detaily, API, datový model
  - [coding conventions] ← jak se v projektu píše kód
```

**Uživatelova role:**
- Popisuje co chce (přirozený jazyk)
- Schvaluje navrhovaná řešení
- Testuje výsledky v prohlížeči
- Schvaluje merge do `main`
- Nepíše kód

### Fáze 4 — Testování (VPS staging)

- Coolify deployuje `staging` větev automaticky
- OpenHands generuje testovací scénáře z use cases person
- Manuální testování uživatelem + AI asistence při hledání bugů
- Bug report → OpenHands opraví → staging deploy → re-test

### Fáze 5 — Produkce

- Merge `staging` → `main` po schválení uživatelem
- Coolify auto-deploy na VPS produkci
- Monitoring: Grafana + Prometheus na VPS
- Rollback: Coolify umožní návrat k předchozí verzi jedním klikem

---

## 13. Komponenty systému

### Telegram bot (`evo007_bot`)

**Role: notifikační a quick-action vrstva** — ne primární UI pro bohaté konverzace.

- Systemd service: `/etc/systemd/system/evo-bot.service`
- Kód: `/opt/evostack/bot_server.py`

**Příkazy:**
- `/projekt <nazev>` — přepnutí aktivního projektu
- `/potvrdit | /upravit | /zrušit` — schvalování tasků
- `/agenti` — zobrazení/úprava sestavy agentů
- `/model <nazev>` — override modelu pro session
- `/budget` — přehled tokenů a nákladů z LangFuse
- `/stav` — stav běžících tasků
- `/poc` — spustit PoC run

**Co Telegram neumí (→ použij Dashboard PWA):**
- Bohaté konverzace s historií
- Multi-persona chaty
- Správa KB a výstupů
- Task trace viewer

### EVO API (FastAPI)

- Docker kontejner `evo-api` na EVO-X2, port 8000
- Přes WireGuard dostupný z VPS jako `10.10.0.2:8000`
- Endpointy: projekty, KB, výstupy, tasky, systém stats, chat WS

### EVO Dashboard (Next.js)

- Repo: `github.com/mparvonic/evo`
- Lokálně: `/Users/miroslav/Projects/evo-dashboard`
- Deployment: Coolify → `https://hello.parvonic.cz`

---

## 14. Open-source stack

| Vrstva | Nástroj | Role | Poznámka |
|---|---|---|---|
| AI serving | **Ollama** | Lokální modely | Unified memory 128 GB |
| Cloud/local proxy | **LiteLLM** | Unified API, routing, cost tracking | Jednotný interface pro lokální i cloud |
| Agent orchestrace (analytika) | **CrewAI** | Role-based multi-agent, výzkum a dokumenty | Aktivně udržovaný |
| Agent orchestrace (vývoj) | **OpenHands** | Autonomní coding agent | MIT, 68k+ hvězd, Docker sandbox, Ollama ready |
| Vektorová DB | **Qdrant** | Sémantické vyhledávání v KB | Self-hosted Docker, REST API |
| Parsování dokumentů | **Docling** | PDF, DOCX → chunky pro RAG | IBM open-source |
| Workflow orchestrace | **Prefect** | PoC/full flow, job tracking, retry | Python-native |
| Observabilita | **LangFuse** | Tracing LLM volání, tokeny, náklady | Self-hosted Docker, MIT |
| Retry logika | **Tenacity** | Retry policies v agentech | Jednoduchá Python lib |
| Guardrails | **guardrails-ai** | Validace výstupů agentů | Open-source |
| Git operace | **GitPython** | Autonomní commity z agentů | Audit trail KB změn |
| Monitoring | **Grafana + Prometheus** | System metrics, VPS monitoring | — |
| Workflow vizuální | **n8n** | Trigger toky, Telegram → API | Self-hosted |
| Deployment | **Coolify** | Docker na VPS, GitHub auto-deploy | — |

### Výhledová evoluce — LangGraph

**LangGraph** (od LangChain) je výhledová alternativa/doplněk k CrewAI pro složitější workflow vyžadující:
- Explicitní state machine s checkpointingem (workflow přežije restart)
- Nativní human-in-the-loop bez vlastního kódu (interrupt_before libovolný uzel)
- Komplexní větvení a podmíněnou logiku

V roce 2026 je LangGraph production-grade a nejaktivněji vyvíjený framework v ekosystému. Přechod z CrewAI na LangGraph nebo jejich kombinace je přirozený krok 2 po stabilizaci základního stacku. SuperAGI byl zvažován, ale projekt je od roku 2024 bez aktivního vývoje — nevhodný pro produkci.

---

## 15. Datové toky — celkový přehled

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANALYTIKA & DOKUMENTY (CrewAI)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Uživatel (Telegram nebo Dashboard Chat)
     ↓ přirozený jazyk
   qwen2.5:14b — klasifikace + rychlá odpověď
     ↓ plánování
   deepseek-r1:32b — CrewAI plán + výběr agentů
     ↓ uživatel schválí / upraví sestavu
   Prefect — PoC run
     ↓ uživatel potvrdí plný run
   CrewAI agenti (qwen2.5:72b nebo cloud přes LiteLLM)
     ├── Qdrant (sémantické vyhledávání v KB)
     ├── Docling (parsování nových dokumentů)
     ├── Web search / email / API nástroje
     └── GitPython (autonomní zápis do KB)
     ↓ průběžný self-checking (judge model)
   LangFuse — tracing všeho (tokeny, čas, náklady, trace)
     ↓ výstupy
   /data/projects/{p}/workspace/  ← reporty, analýzy
   /data/projects/{p}/knowledge/  ← aktualizovaná KB
   Git commit (EVO-X2) → GitHub  ← audit trail
     ↓ shrnutí
   Telegram / Dashboard — souhrn tasku

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VÝVOJ APLIKACÍ (OpenHands)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Uživatel (Telegram nebo Dashboard Chat)
     ↓ popis featury / bugu / prototypu
   EVO API — příprava kontextu z KB projektu
     ├── _PROJECT.md
     ├── rozhodnuti/*.md (ADR)
     └── technicka/*.md (konvence, datový model)
     ↓
   OpenHands (Docker sandbox na EVO-X2)
     ├── LiteLLM → lokální model (qwen2.5:72b) nebo cloud
     ├── Filesystem: /data/projects/{p}/app/ (workspace)
     ├── Git: clone z GitHub, práce na feature větvi
     ├── Terminal: spouštění testů, build, linting
     └── Browser: ověření výsledku
     ↓ průběžný výstup viditelný v Dashboard
   LangFuse — tracing (tokeny, čas, kroky)
     ↓ kód hotov
   Git push → GitHub (feature větev)
     ↓ uživatel schválí merge → staging
   Coolify webhook → auto-deploy na VPS staging
     ↓ uživatel otestuje
   Merge staging → main
   Coolify webhook → auto-deploy na VPS produkce
```

---

## 16. Implementační postup (navrhované pořadí)

### Priorita 1 — Základní AI vrstva (týden 1–2)
1. LiteLLM proxy — unified interface pro lokální i cloud modely
2. Qdrant — vektorová DB, indexace existující KB
3. LangFuse — tracing, token monitoring

### Priorita 2 — Autonomní proces (týden 3–4)
4. Prefect — PoC flow + plný flow s parametry
5. Self-checking logika v CrewAI agentech
6. Eskalační handler v bot_server.py
7. GitPython integrace pro autonomní KB commity

### Priorita 3 — Dashboard (týden 5–7)
8. Pohled: Globální přehled projektů
9. Pohled: Detail projektu
10. Pohled: Detail tasku (LangFuse trace viewer)
11. Pohled: KB prohlížeč + editor

### Priorita 4 — Persona & Agent management (týden 8–9)
12. YAML definice agentů, editor v Dashboardu
13. Persona struktura v KB
14. Persona agenti (plánování + vyhodnocení)

### Priorita 5 — Zdroje & Email (týden 10–11)
15. Správa zdrojů per task (sources.md, režimy CLOSED/OPEN/GUIDED)
16. Projektová knihovna zdrojů + digest pipeline
17. Dedikovaná emailová schránka + integrace (příjem + schvalovací flow odesílání)
18. Autonomní web browsing agent

### Priorita 6 — App development workflow (týden 12–14)
19. Git workflow (main/staging/dev/feature) + GitHub remote
20. Coolify auto-deploy z GitHubu
21. **OpenHands** — instalace, Docker sandbox na EVO-X2, napojení na LiteLLM
22. Integrace OpenHands s EVO API (KB kontext při každém spuštění)
23. OpenHands v Dashboardu — task detail viewer pro vývojové úkoly
24. Prototypovací workflow (React mockupy s mock daty přes OpenHands)

### Výhledová evoluce (krok 2, bez časového závazku)
- Evaluace LangGraph jako doplněk/náhrada CrewAI pro workflow s komplexním větvením
- Migrace vybraných CrewAI flows na LangGraph pokud to přinese hodnotu
- LangGraph nativní human-in-the-loop jako alternativa k vlastnímu eskalačnímu handleru

---

*Dokument je živý — aktualizovat s každou větší architektonickou změnou.*
