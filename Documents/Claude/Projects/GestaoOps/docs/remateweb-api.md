# RemateWeb API — referência para o GestaoOps

Mapa dos endpoints e payloads da plataforma RemateWeb (painel `painel-net9`) que o
GestaoOps vai consumir e, futuramente, escrever. Fonte: OpenAPI 3.0.1 "Remate Web API v1".

| Ambiente | Painel (SPA Angular) | API (ASP.NET) |
|---|---|---|
| Teste | `https://test.painel-net9.remateweb.com` | `https://test.api-net9.remateweb.com` |
| Produção | — | `https://api.remateweb.com` |

- **Swagger:** `{API}/swagger/index.html` · spec em `{API}/swagger/v1/swagger.json` (~664 KB).
  Para parsear, use **Node** (não PowerShell `ConvertFrom-Json` — a spec tem chaves
  duplicadas case-insensitive, ex. `DeviceOS`/`DeviceOs`).
- **Auth:** OAuth password grant em `POST /token` (`grant_type=password`), Bearer token.
- **Listas:** `GET /api/{entidade}?orderBy=name&pageIndex=1&pageSize=N&sortDirection=asc`,
  resposta envelopada `{ "<plural>": [...], "quantity": N }`.

> Estado atual: o GestaoOps **lê** a API (importação de leilões) e adiciona a camada
> operacional própria (escala, pagamentos, planning). A escrita (`POST/PUT /api/auction`)
> é fase futura — por isso os selects de catálogo já carregam os `id` reais.

---

## Catálogos (Configurações) → selects do cadastro

Implementados em [`src/services/remateweb-api.ts`](../src/services/remateweb-api.ts),
tipados em [`src/types/catalog.ts`](../src/types/catalog.ts), agregados no hook
[`src/lib/useCatalogs.ts`](../src/lib/useCatalogs.ts).

| Catálogo | Lista | Item (campos) | Fetcher |
|---|---|---|---|
| Raças | `GET /api/breed` · `/api/breed/all` · `/api/breed/allforfilter` | `id, name, breedTypeId, breedTypeName, visible, createDate, breedTranslations[]` | `fetchBreeds()` |
| Tipos de Raça | `GET /api/breedtype/{id}` (lista via `/api/breedType`) | `id, name, createDate, breedTypeTranslations[]` | `fetchBreedTypes()` |
| Parceiros | `GET /api/partner` | `id, name, url, email, eventMaker, apiKey, image, bucket, imageComplete` | `fetchPartners()` / `fetchEventMakers()` |
| Canais | `GET /api/channel` | `id, name` | `fetchChannels()` |
| Grupos de Incremento | `GET /api/bidincrementgroup` | `id, name` | `fetchBidIncrementGroups()` |
| Streaming | `GET /api/streaming` | `id, name, ip, port, wss, application, stream, status, organization` | — |
| Studios | `GET /api/studio` · `/api/studio/all` | `id, name` | `fetchStudios()` |
| Unidades ⚠️ | `GET /api/unity` | `id, name` | `fetchUnities()` |

⚠️ **`/api/unity` não está no swagger** (legado/undocumented), mas responde 200 com
`{unities, quantity}`. É usada a nível de **lote**, não do leilão — não bloqueia o
cadastro de evento, mas pode sumir numa futura versão da API.

### Regras de incremento de lance
- Por **grupo**: `GET /api/bidincrementrules/bygroup/{groupId}` ·
  `POST /api/bidincrementrule` · `GET,PUT,DELETE /api/bidincrementrule/{id}`
  → `{ id, minValue, maxValue, incrementValue, bidIncrementGroupId }`
- Por **leilão**: `GET /api/auctionbidincrementrules/byauction/{auctionId}` ·
  `POST /api/auctionbidincrementrule` · `POST /api/auctionbidincrementrule/copy`
  → `{ id, minValue, maxValue, incrementValue, auctionId }`

---

## Cadastro de evento (Leilão)

### `POST /api/auction` · `PUT /api/auction/{id}` · `GET /api/auction/{id}` · `DELETE /api/auction/{id}`

Corpo = schema **`Auction`**. Campos principais (todos no payload de criação):

**Identificação e relacionamentos**
- `title` — título
- `organizationId` → Parceiro (organização) · `partnerId` → Parceiro (leiloeira/realizador)
- `breedId` → Raça principal · `channelId` → Canal · `streamingId` → Streaming
- `currencyId` / `currency` · `regionId` (string; `br` / `bo`)
- `auctionCategoryId` → categoria (ver `/api/auctioncategory`)
- `leilaoCodigo`, `financialCode`, `condicaoCodigo`, `condicaoDescricao` — integração financeira

**Datas** — `date`, `endDate`, `onlineUntil` (date-time)

**Tipo e flags**
- `saleType` — enum **SaleType**: `0` Reserva · `1` Normal · `2` Shopping · `3` Pré Lance
- `visible`, `agenda`, `transmission`, `live`, `aceptBids`, `hideTimers`, `forceYoutube`, `youtubeOnApp`
- `ocrType` — enum OcrType `0|1|2`

**Lances / financeiro**
- `increment` (double), `captation` (int), `paymentConditions`, `shoppingPaymentConditions`, `paymentConditionObservation`
- `buyerTax`, `sellerTax`, `unitTax` (double)

**Local** — `place`, `city`, `state`

**Mídia** — `youtubeId`, `youtubePlaylist`, `enbedVideo`, `image`, `eventImage`,
`shoppingImage`, `backGroundImage`, `backGroundColor`, `catalogFile`, `folderFile`,
`lotOrderFile`, `bucket*` (campos de bucket S3)

**Workflow de análise** — `registrationAnalystName/Phone`, `bidApprovalAnalystName/Phone`,
`notifyAnalystOnLiberation`, `notifyAnalystOnBid`, `whatsappInstanceName`

**Coleções aninhadas** (também têm controllers próprios — preenchíveis após criar o leilão):
`auctionBreeds[]`, `lots[]`, `auctionPartners[]`, `auctionOwners[]`, `auctionLinks[]`,
`auctionReminders[]`, `auctionPhoneNumbers[]`, `auctionInterests[]`, `documents[]`,
`auctionProvidedServices[]`, `auctionContractors[]`, `audience[]` / `userAudience[]`.

### Sub-recursos do leilão
| Recurso | Endpoints | Payload-chave |
|---|---|---|
| Raça do leilão | `POST /api/auctionbreed` · `GET,PUT,DELETE /api/auctionbreed/{id}` | `{ auctionId, breedId }` |
| Parceiro do leilão | `GET,POST /api/auctionpartner` · `.../{id}` | `{ auctionId, partnerId, partnerType(enum 0\|1\|2), url, order }` |
| Proprietário | `GET,POST /api/auctionowner` · `/api/auctionowners` | — |
| Link | `POST /api/auctionlink` · `.../{id}` | — |
| Telefone | `GET,POST /api/auctionphonenumber` | `phoneType` enum `0..4` |
| Lotes | `POST /api/auction/createlots` · `POST /api/auction/lotimportation` · `GET /api/lot/auctionlots/{id}` | lote usa **unity** |
| Liberações | `GET,POST /api/auctionliberation` · `/statuschange` · `/request` | `AuctionLiberationStatus 0..3` |
| Ordenação | `PUT /api/auction/changeorder/{id}` · `/changelotorder/{id}` · `/setlotsvisible/{id}` | — |
| Utilidades | `POST /api/auction/duplicate` · `/applyconfigs` · `GET /api/auction/resume/{id}` · `/taxes/{id}` · `/paymentconditions/{id}` | — |

---

## Notificações

### `POST /api/notification`
Corpo = **`NotificationCreateVm`**:
```jsonc
{
  "breeds": [int],        // IDs de Raça (checkboxes "Raças de Interesse"); vazio = todos
  "sendToOthers": bool,   // "Enviar para anônimos" (estava desativado em teste)
  "title": string,
  "message": string,
  "auctionId": int|null   // se informado → categoria AuctionReminder
}
```

### Lembrete de leilão (AuctionReminder)
- `GET,POST /api/auctionreminder` · `PUT,GET /api/auctionreminder/{id}`
- `POST /api/auctionreminder/send/{auctionId}` — dispara o lembrete
- `GET /api/auction/available-for-notification` — leilões elegíveis para vincular

### Inbox do usuário (app) — não confundir com envio
`GET /api/notifications`, `/unread-count`, `POST /api/notifications/{id}/read`,
`/read-all`, `DELETE /api/notifications/{id}`, `/api/notification-preferences`.

---

## Enums úteis (todos `integer`)
| Enum | Valores | Uso |
|---|---|---|
| `SaleType` | 0 Reserva · 1 Normal · 2 Shopping · 3 Pré Lance | `Auction.saleType` |
| `PartnerType` | 0 · 1 · 2 (rótulos a confirmar) | `AuctionPartner.partnerType` |
| `PhoneType` | 0..4 | telefones |
| `AuctionLiberationStatus` | 0..3 | liberações |
| `OcrType` | 0..2 | `Auction.ocrType` |
| `NotificationType` | 0..2 | notificações |
| `StreamingType` | 0..1 | streaming |

> Rótulos dos enums sem nome explícito na spec (ex. `PartnerType`) devem ser confirmados
> na UI do painel antes de usar como verdade.
