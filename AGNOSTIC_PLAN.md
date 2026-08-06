# Plan — Rendre BlitzJS agnostique du runtime

État constaté dans le code (`src/`), pas une recopie du README. Objectif : le
moteur de routing/middleware ne doit plus connaître `uWebSockets.js` — chaque
runtime (uWS, Node, Bun, Deno, Workers...) devient un simple adaptateur.

## Priorité décidée (2026-08-06)

`uWebSockets.js` marche mal avec Bun (binaire natif, pas de binding Bun
officiel). Donc on **priorise Node + Bun d'abord** (tous deux passent par
`adapters/fetch.ts`, Request/Response standard — pas de binaire natif requis).
uWS reste supporté mais son adaptateur (`adapters/uws.ts`) et `.ws()` sont
**reportés** — étape 3/4 (colonne uWS) et étape 6 en fin de liste, pas
bloquants pour livrer Node+Bun.

## 1. Ce qui existe déjà (bonne nouvelle : le chantier est commencé)

- `src/core/runtime.ts` — interfaces `RuntimeRequest` / `RuntimeResponse`,
  déjà pensées agnostiques (méthodes `method()/path()/header()/parseBody()`
  + alias legacy `getMethod()/writeHeader()/end()` pour coller à l'API uWS).
- `src/core/platform.ts` — `RuntimeServices` (fs abstrait : `readFile`,
  `fileExists`, `randomId`) déjà utilisé par `static-file.ts`.
- `src/adapters/` — 4 adaptateurs déjà présents :
  - `uws.ts` : `UwsRequestAdapter` / `UwsResponseAdapter` (implémentent
    `RuntimeRequest`/`RuntimeResponse` par-dessus uWS).
  - `fetch.ts` : `FetchRequestAdapter` / `FetchResponseAdapter` + 
    `createFetchHandler(app: FetchDispatchApp)` — attend une app qui expose
    `dispatchRuntimeRequest(req, res)`.
  - `bun.ts` : `serveWithBun()`, réutilise `createFetchHandler`.
  - `node.ts` : bridge Node `http` → `Request`/`Response` standard, autonome
    (n'utilise pas encore `RuntimeRequest`/`RuntimeResponse`).
- `templates.ts`, `simple-handler.ts`, `static-file.ts` — déjà écrits contre
  `ctx.res.writeHeader/writeStatus/end/aborted`, qui correspondent aux alias
  legacy de `RuntimeResponse`. **Ces fichiers n'ont donc rien à changer.**

## 2. Ce qui bloque encore l'agnosticisme

Le cœur (`BlitzJS.ts`) n'a jamais été branché sur `RuntimeRequest`/
`RuntimeResponse` : il parle directement à uWS.

| Fichier | Couplage uWS | Impact |
|---|---|---|
| `core/types.ts:1,16-18` | `RouteContext.req`/`res` typés `HttpRequest`/`HttpResponse` (uWS) | Tout le framework (handlers, middlewares, plugins) hérite du couplage via ce seul type |
| `core/BlitzJS.ts:18` | `import { App, SSLApp, TemplatedApp, HttpRequest, HttpResponse, WebSocketBehavior } from 'uWebSockets.js'` | Constructeur crée toujours une app uWS (`App()`/`SSLApp()`) |
| `core/BlitzJS.ts` `setupRoutes()`, `handleRequest()`, `listen()`, `ws()`, `getUwsApp()` | Signature `(req: HttpRequest, res: HttpResponse)`, `app.listen(...)`, `app.ws(...)` | Bootstrap serveur + WebSocket indissociables du moteur de routing |
| `core/body.ts:1,56-74` | `parseBody(res, req, contentType)` utilise `res.onData`/`res.onAborted` (API uWS uniquement) | Ne fonctionne que sur uWS ; heureusement `parseBodyBuffer` (agnostique) existe déjà et sert aux autres adaptateurs |
| `core/response-buffer.ts:1,15-61` | `bufferResponse(res: HttpResponse)` — proxy pour retarder `writeStatus` (contrainte uWS : premier appel obligatoire) | Utilisé directement dans `BlitzJS.handleRequest`, alors que c'est un détail d'implémentation uWS |
| `index.ts:55` | `export type { HttpRequest, HttpResponse, TemplatedApp, WebSocket, WebSocketBehavior } from 'uWebSockets.js'` | Force la résolution des types uWS pour n'importe quel consommateur du package |
| `package.json` | `uWebSockets.js` en `dependencies` **et** `peerDependencies` | Installé de force (binaire natif via git) même pour un usage Node/Bun/fetch pur |

## 3. Architecture cible

```
                     ┌───────────────────────────────┐
                     │      BlitzJS (core moteur)     │
                     │ routing, middlewares, codegen,  │
                     │ validation, sessions, cors...   │
                     │                                 │
                     │ dispatchRuntimeRequest(          │
                     │   req: RuntimeRequest,           │
                     │   res: RuntimeResponse            │
                     │ ): Promise<void>                 │
                     └───────────────┬─────────────────┘
                                     │ ne connaît que
                                     │ RuntimeRequest/RuntimeResponse
        ┌────────────┬───────────────┼───────────────┬────────────┐
        │            │               │               │            │
   adapters/uws  adapters/node  adapters/bun   adapters/fetch  (futur: deno,
   (App/SSLApp,  (http.Server)  (Bun.serve)    (Workers, Deno)  workerd...)
   bufferResponse,
   parseBody uWS)
```

Le moteur ne crée plus jamais de serveur lui-même. Chaque adaptateur :
1. écoute son runtime natif,
2. convertit la requête native en `RuntimeRequest`/réponse en `RuntimeResponse`,
3. appelle `blitz.dispatchRuntimeRequest(req, res)`,
4. gère le bootstrap (`listen`, options SSL, etc.) — spécifique à son runtime.

## 4. Étapes (incrémentales, sans casser l'existant à chaque étape)

**Étape 1 — Généraliser `RouteContext`**
- `core/types.ts` : remplacer `HttpRequest`/`HttpResponse` par
  `RuntimeRequest`/`RuntimeResponse` (déjà définis dans `core/runtime.ts`).
- Vérifier tous les usages de `ctx.req.*` dans le repo (`auth.ts`, `cors.ts`,
  `session.ts`, etc.) — ne garder que les méthodes présentes sur
  `RuntimeRequest` (`header()`/`getHeader()` existent déjà des deux côtés).

**Étape 2 — Extraire le moteur du bootstrap serveur**
- Dans `BlitzJS.ts` : supprimer la création `App()`/`SSLApp()`, `setupRoutes()`,
  `listen()`, `ws()`, `getUwsApp()` du cœur.
- Renommer `handleRequest(req, res)` en `dispatchRuntimeRequest(req: RuntimeRequest, res: RuntimeResponse)`
  et remplacer les appels `req.getUrl()/getQuery()/getHeader()` par les
  méthodes `RuntimeRequest` équivalentes (déjà aliasées, donc mécanique).
- `matchRoute`/`addRoute`/`pattern.ts` restent inchangés (déjà agnostiques,
  travaillent sur des strings/regex).

**Étape 3 — Déplacer les helpers uWS-only vers `adapters/uws.ts`**
- `response-buffer.ts` (`bufferResponse`) → déplacer dans `adapters/uws.ts`
  (déjà à moitié dupliqué là-bas dans `UwsResponseAdapter`) ; le cœur ne
  l'importe plus.
- `body.ts` : garder `parseBodyBuffer`/`parseQueryString` (agnostiques) dans
  `core/`, déplacer le `parseBody(res, req, ...)` spécifique `onData/onAborted`
  dans `adapters/uws.ts`.

**Étape 4 — Brancher chaque adaptateur sur `dispatchRuntimeRequest`**
- `adapters/uws.ts` : ajouter `serveWithUws(app, options)` qui crée
  `App()`/`SSLApp()`, enregistre les routes catch-all (`/*` pour chaque
  méthode), et route chaque requête vers
  `app.dispatchRuntimeRequest(new UwsRequestAdapter(...), new UwsResponseAdapter(...))`.
- `adapters/fetch.ts` : déjà prêt (`createFetchHandler` attend
  `dispatchRuntimeRequest`) — juste vérifier que `BlitzJS` l'expose.
- `adapters/bun.ts` : déjà prêt (réutilise `createFetchHandler`).
- `adapters/node.ts` : décider — v1 simple = brancher sur `createFetchHandler`
  (une conversion Request/Response de plus, mais code unique) ; v2 perf =
  écrire un `NodeRequestAdapter`/`NodeResponseAdapter` direct type
  `RuntimeRequest`/`RuntimeResponse` pour éviter la double conversion. Ne pas
  optimiser avant d'avoir mesuré (benchmark existant dans `benchmark/`).

**Étape 5 — Nettoyer `index.ts` / `package.json`**
- Retirer le ré-export uWS de `index.ts` (ligne 55) ; le déplacer dans un
  sous-chemin dédié, ex. `@damienmonchaty/blitzjs/uws`.
- `package.json` : sortir `uWebSockets.js` de `dependencies`, le laisser
  uniquement en `peerDependencies` + `peerDependenciesMeta.optional: true`.
- Ajouter un champ `exports` (`.`, `./uws`, `./node`, `./bun`, `./fetch`) pour
  que chaque runtime n'importe que ce dont il a besoin (évite de tirer le
  binaire natif uWS pour un usage Node/Bun/fetch pur).

**Étape 6 — WebSocket (`.ws()`) — non bloquant**
- Rester sur `.ws()` en tant que capacité spécifique à l'adaptateur uWS pour
  la v1 (documenté comme limitation), une abstraction WS générique peut
  attendre une v2.

## 5. Points d'attention / risques

- **Aucun test dans le repo actuellement** (`find -iname "*test*"` : rien).
  Avant de toucher `BlitzJS.ts`, écrire au minimum un test d'intégration par
  adaptateur (mêmes routes, même comportement attendu) — sinon la migration
  se fait à l'aveugle.
- **Perf** : le chemin uWS + codegen (`templates.ts`) est le point fort du
  projet ("ultra-fast"). Vérifier avec `benchmark/` (autocannon déjà en
  devDependency) qu'ajouter l'indirection `RuntimeRequest`/`RuntimeResponse`
  ne dégrade pas le chemin uWS.
- **Breaking change** : `ctx.req`/`ctx.res` ne seront plus typés uWS par
  défaut → tout code utilisateur qui appelle des méthodes uWS spécifiques
  non présentes sur `RuntimeRequest`/`RuntimeResponse` cassera. À documenter
  dans un changelog / bump majeur.

## 6. Definition of done

- `BlitzJS.ts` ne contient plus aucun `import ... from 'uWebSockets.js'`.
- `npm install` sans `uWebSockets.js` permet de démarrer l'app via
  `adapters/node.ts` ou `adapters/bun.ts`.
- Les 4 adaptateurs (uws/node/bun/fetch) passent le même jeu de tests
  d'intégration avec des résultats identiques.
- Le benchmark uWS ne régresse pas (± marge acceptable à définir).
