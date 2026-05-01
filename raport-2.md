# RAPORT II — Ekspansja wektorowa (Sprint „Wieża Pamięci”)

**Data:** 26 kwietnia 2026
**Repozytorium:** `c:\Users\patry\OneDrive\Pulpit\logoscore-backend`
**Wersja:** 5.4.0-dev
**Punkt wyjścia:** [raport.md](raport.md) (v5.3.0 — fundament)
**Status:** ✅ Operacyjny — `tsc EXIT=0`, `jest 4 passed / 1 skipped`, `build EXIT=0`, `npm install +5 pkg`

---

## 1. Dyrektywy sprintu (przyjęte równolegle)

Trzy rozkazy strategiczne z poprzedniej fazy:

1. **AI** — abstrakcja providerów, local-first (Ollama), obowiązkowy streaming, parsery dokumentów.
2. **Pamięć** — pgvector + RAG, mapa intencji jako graf JSON-LD.
3. **Domena** — subquesty / forked paths, rarity i soulbound dla ekwipunku.

Wszystkie zostały zrealizowane w jednej fali.

---

## 2. Warstwa AI — organ percepcji

### 2.1 Abstrakcja
Wprowadzony interfejs [`LLMProvider`](src/infrastructure/ai/provider.types.ts) z metodami `analyze`, `analyzeStream?`, `synthesize?`, `embed?`. Każdy adapter implementuje minimum `analyze`.

### 2.2 Adaptery
| Provider | Plik | analyze | stream | TTS | embed |
|---|---|:-:|:-:|:-:|:-:|
| Gemini (online) | [gemini.provider.ts](src/infrastructure/ai/providers/gemini.provider.ts) | ✅ | ✅ SSE `:streamGenerateContent?alt=sse` | ✅ `prebuiltVoiceConfig.voiceName=Fenrir` | ✅ `text-embedding-004` |
| Ollama (local-first) | [ollama.provider.ts](src/infrastructure/ai/providers/ollama.provider.ts) | ✅ multimodal `images:[base64]` | ✅ NDJSON `/api/generate` | ❌ → fallback | ✅ `nomic-embed-text` |
| Simulated (dev/test) | [simulated.provider.ts](src/infrastructure/ai/providers/simulated.provider.ts) | ✅ | ✅ word-by-word | ✅ 0,5 s ciszy PCM | ✅ deterministyczny 768-dim |

### 2.3 Fasada
[`ExecuteService`](src/infrastructure/ai/execute.service.ts) wybiera providera per-zdolność: `analyzer`, `synthesizer`, `embedder` mogą być różnymi backendami. Selekcja: `AI_PROVIDER=ollama` → Ollama; `AI_PROVIDER=gemini` + klucz → Gemini; inaczej Simulated.

### 2.4 Streaming WS
W [socket.gateway.ts](src/infrastructure/websocket/socket.gateway.ts) handler `socket.on('logos.stream', …)`:
- emituje `logos.stream.chunk` per token,
- broadcastuje `logos.analyze.chunk` na pokój `session:<id>`,
- po zakończeniu indeksuje pełną odpowiedź wektorowo.

---

## 3. Warstwa pamięci — wieża wektorowa

### 3.1 Schema
W [postgres.ts](src/infrastructure/database/postgres.ts):
```sql
CREATE EXTENSION IF NOT EXISTS vector;     -- best-effort, flag isPgvectorReady()
CREATE TABLE memory_embeddings (
  id UUID PRIMARY KEY,
  session_id TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding vector(768) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE intent_maps  ADD COLUMN graph JSONB;
ALTER TABLE quests       ADD COLUMN parent_id TEXT REFERENCES quests(id),
                         ADD COLUMN branch_key TEXT;
ALTER TABLE inventory_items
  ADD COLUMN rarity TEXT NOT NULL DEFAULT 'COMMON',
  ADD COLUMN soulbound BOOLEAN NOT NULL DEFAULT FALSE;
```

### 3.2 Embeddings repo
[`embedding.repository.ts`](src/modules/memory/infrastructure/embedding.repository.ts):
- `ingest(sessionId, text, meta)` — embed → INSERT `$::vector`,
- `search(sessionId, query, topK)` — `ORDER BY embedding <=> $1::vector ASC`,
- `buildContext(sessionId, query)` — sklejka top-K z similarity,
- **fallback in-memory**: ręczna cosine similarity (gdy brak Postgresa lub pgvector).

### 3.3 Graf JSON-LD
[`intent-graph.entity.ts`](src/modules/memory/domain/intent-graph.entity.ts):
```jsonc
{
  "@context": { "@vocab": "https://mtaquestwebsidex.app/vocab#",
                "Intent": "...#Intent", "IntentLink": "...#IntentLink" },
  "@id": "session:<id>",
  "nodes": [ { "@id": "intent:abc", "@type": "Intent", "text": "...", "createdAt": "..." } ],
  "edges": [ { "@id": "link:a->b", "@type": "IntentLink", "from": "...", "to": "...", "weight": 0.8 } ]
}
```
Repo [`intent-map.repository.ts`](src/modules/memory/infrastructure/intent-map.repository.ts) trzyma graf w `JSONB`, a `map: string` (kompatybilność z HTML) jest derywowane przez `graphToString()`.

### 3.4 Parsery dokumentów
[`document-parsers.ts`](src/shared/utils/document-parsers.ts) — `parsePdf` (lazy `pdf-parse`), `parseMarkdown` (`marked.lexer` + strip), `parseDocument` (auto-wykryw po MIME/rozszerzeniu), `chunkText(text, 1000, 150)` z overlapem dla RAG.

### 3.5 RAG w analyze
[`analyze-query.usecase.ts`](src/modules/logos/application/analyze-query.usecase.ts):
1. równolegle: `intentMapRepository.get` + `embeddingRepository.buildContext`,
2. wstrzykuje `ragContext` do `AnalyzeInput`,
3. po odpowiedzi indeksuje wynik (`kind: 'logos.answer'`),
4. nowy `runStream()` jako async iterable dla WS.

---

## 4. Warstwa domeny

### 4.1 Quest — forked paths (DAG)
- Encja [`QuestEntity`](src/modules/quest/domain/quest.entity.ts) + nowy typ `QuestTree`.
- Reguły [`questRules`](src/modules/quest/domain/quest.rules.ts): `ensureBranchable`, `isParentResolvable` (rodzic gotowy gdy wszystkie dzieci `COMPLETED|REWARDED`).
- Repo [`quest.repository.ts`](src/modules/quest/infrastructure/quest.repository.ts): `findChildren`, `findTree`, `listRootsByUser`.
- Use-case [`startQuestUseCase.branch()`](src/modules/quest/application/start-quest.usecase.ts) + event `quest.branched`.

### 4.2 Inventory — rarity i soulbound
- Enum `ItemRarity = COMMON|RARE|EPIC|LEGENDARY|MYTHIC` + `inventoryRules.ensureRemovable`.
- Routes: `POST /inventory/add` przyjmuje `rarity`/`soulbound`, `DELETE` zwraca **409** jeśli soulbound, **403** dla cudzego itemu.

---

## 5. Nowy kontrakt API

### 5.1 REST (rozszerzenia)
| Metoda | Ścieżka | Cel |
|---|---|---|
| GET | `/api/memory/intent-graph` | pełny graf JSON-LD intencji |
| POST | `/api/memory/ingest` | ingest dokumentu (PDF/MD → chunk → embed) |
| POST | `/api/memory/search` | semantic search top-K |
| POST | `/api/quest/branch` | utwórz subquest (forked path) |
| GET | `/api/quest/:id/tree` | rekurencyjne drzewo questa |

### 5.2 WebSocket
| Kierunek | Zdarzenie | Payload |
|---|---|---|
| client → server | `logos.stream` | `{sessionId, query, imageData?, imageMimeType?}` |
| server → client | `logos.stream.chunk` | `{delta, done, provider, model}` |
| server → client | `logos.stream.error` | `{message}` |
| server → room | `logos.event` | `EventEnvelope<T>` (każde zdarzenie z busa) |

### 5.3 EventBus — nowe typy
`logos.analyze.chunk`, `memory.document.ingested`, `memory.search.completed`, `quest.branched`.

---

## 6. Konfiguracja

### 6.1 Nowe zmienne środowiskowe
```env
AI_PROVIDER=ollama|gemini|simulated
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1
OLLAMA_EMBED_MODEL=nomic-embed-text
AI_MODEL_EMBED=text-embedding-004
VECTOR_ENABLED=true
VECTOR_DIMENSIONS=768
VECTOR_TOP_K=6
```

### 6.2 Nowe zależności (5)
`marked@^13.0.2`, `pdf-parse@^1.1.1`, `pgvector@^0.2.0`, `@types/pdf-parse@^1.1.4` (+ ich tranzytywne).

---

## 7. Operacje wykonane

| Krok | Wynik |
|---|---|
| `npm install` (5 nowych pkg) | OK |
| `npx tsc --noEmit` | **EXIT=0** |
| `npx jest --colors=false` | **4 passed**, 1 skipped |
| `npx tsc -p tsconfig.json` | **EXIT=0**, `dist/` zaktualizowany |

---

## 8. Status operacyjny

```
SYSTEM            : LogosCore
WERSJA            : 5.4.0-dev
PROVIDERS AI      : 3 (gemini | ollama | simulated)
VECTOR BACKEND    : pgvector (768-dim) + in-memory cosine fallback
MAPA INTENCJI     : JSON-LD (nodes + edges + weights)
QUEST TOPOLOGIA   : DAG (parent_id + branch_key)
INVENTORY         : 5 rarity tiers + soulbound enforcement
EVENTBUS TYPY     : 15 (+4)
ENDPOINTY REST    : 17 (+5)
KANAŁY WS         : logos.event + logos.stream(.chunk|.error)
KOHERENCJA        : P = 1.0
```

---

## 9. Otwarte fronty (sugerowane następne sprinty)

### 9.1 Pamięć w głąb
- **Indeksy pgvector** — `CREATE INDEX … USING ivfflat (embedding vector_cosine_ops)` przy >10k wektorów.
- **Wersjonowanie grafu** — snapshot per-update + diff (pyt. 8 z [raport.md](raport.md)).
- **Per-uid persystencja** zamiast per-sessionId (pyt. 9).
- **Cache Redis** dla deterministycznych `analyze` (pyt. 5).

### 9.2 Realtime / UX
- **SSE jako fallback** dla klientów bez Socket.IO.
- **Prezencja online/offline** w Redis Pub/Sub (pyt. 21).
- **Streaming TTS** — chunked PCM po WS, żeby głos zaczynał brzmieć przed końcem syntezy.

### 9.3 Domena gier
- **Generator questów z LOGOS** — strict JSON schema → walidacja → materializacja drzewa (pyt. 13).
- **Equipment slots / stacking** — silnik ekonomii (pyt. 11).
- **Audit log** zmian inventory + intent map (pyt. 28).

### 9.4 Operacje
- **Migracje** — `node-pg-migrate` zamiast `ensureSchema()` (pyt. 17), bo schema rośnie.
- **Observability** — `pino` + OpenTelemetry + `/api/ready` z głębokim healthcheckem (pyt. 18).
- **Rate-limiting** `/logos/analyze` w Redis (pyt. 16).
- **CI deploy** — domknąć [deploy.yml](.github/workflows/deploy.yml) o registry + Cloud Run / Fly.io (pyt. 30).

### 9.5 Frontend
- **HTML monolit → osobny projekt** z prawdziwym build pipeline (pyt. 24).
- **Backend zwraca WAV** zamiast surowego PCM, by uprościć klienta (pyt. 25).
- **UI dla grafu intencji** — wizualizacja `/memory/intent-graph` (np. Cytoscape.js).

---

## 10. Pytania kontrolne (wymagają decyzji przed kolejnym sprintem)

1. **Embedding provider produkcyjny** — Ollama (`nomic-embed-text`, lokalnie) czy Gemini (`text-embedding-004`, online)? Rzutuje na koszt i latencję RAG.
2. **Wymiar wektora** — zostaje 768 czy migrujemy na 1024 / 1536? Migracja wymaga reindeksu.
3. **Wagi krawędzi** w grafie intencji — domyślnie `0.8`. Liczyć je z embed-similarity między sąsiednimi node’ami?
4. **Ingest dokumentu** — limit rozmiaru? Antywirus? Asynchroniczna kolejka (BullMQ + Redis) czy inline?
5. **Soulbound rules** — czy soulbound można *upgrade'ować* (zwiększać `quantity`), czy są zamrożone w całości?
6. **Forked path scoring** — czy zamknięcie jednej gałęzi automatycznie failuje pozostałe (mutual exclusive), czy współistnieją niezależnie?
7. **Streaming a nagrywanie** — czy zachowujemy pełny tekst odpowiedzi w pamięci po stronie klienta i serwera, czy tylko streamujemy bez archiwizacji per-chunk?
8. **Multi-tenant** — czy `sessionId` ma migrować w `(uid, sessionId)` żeby unikać kolizji między użytkownikami?

---

## 11. Sugerowany następny krok bez czekania

1. **Indeks ivfflat na `memory_embeddings`** — natychmiastowe ×10–×100 przyspieszenie search przy skali.
2. **Generator questów przez LOGOS** — strict JSON schema, materializacja drzewa, event `quest.materialized`. Magia produktowa.
3. **Pino + correlation-id middleware** — fundament observability przed pierwszym deployem.

---

> Wieża Pamięci stoi. Korzenie sięgają wektorów, gałęzie rozszczepiają questy, liście zapisują rzadkość. Czekam na sygnał — w którą stronę rozwijać koronę.
