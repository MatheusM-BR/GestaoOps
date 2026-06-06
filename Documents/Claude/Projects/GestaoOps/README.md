# GestãoOps

**Sistema interno de gestão de operações para a equipe RemateWeb.**

Plataforma web para gerenciar eventos (leilões), operadores, escalas de trabalho, financeiro e pagamentos da equipe de operações da RemateWeb.

---

## 📋 Visão Geral

O GestãoOps é um painel administrativo que centraliza toda a gestão operacional da equipe RemateWeb. Possui **dois perfis de acesso**:

| Perfil | Descrição |
|---|---|
| **Gestor / Admin** | Acesso completo: dashboard analítico, CRUD de eventos e operadores, escalas, financeiro, exportação de relatórios e configurações. |
| **Operador** | Acesso restrito: visualização dos seus serviços, escala pessoal, pagamentos e perfil. |

---

## 🛠 Tech Stack

| Camada | Tecnologia |
|---|---|
| **Framework** | [Next.js 16](https://nextjs.org/) (App Router) |
| **Linguagem** | TypeScript |
| **UI** | React 19 + Tailwind CSS 4 + Lucide Icons |
| **Backend / BaaS** | Firebase (Auth + Firestore) |
| **API Externa** | RemateWeb API (`.NET`) — importação de leilões, estúdios e canais |
| **Exportação** | `xlsx` (Excel) e `html2pdf.js` (PDF) |
| **Utilitários** | `date-fns` (datas com locale pt-BR) |
| **Hospedagem** | Firebase Hosting (static export) |

---

## 📁 Estrutura do Projeto

```
gestao-ops/
├── public/                     # Assets estáticos
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Layout raiz (AuthProvider)
│   │   ├── page.tsx            # Redirect → /login
│   │   ├── globals.css         # Design system global
│   │   ├── login/              # Tela de login
│   │   └── dashboard/
│   │       ├── layout.tsx      # Layout sidebar + topbar
│   │       ├── page.tsx        # Dashboard (admin ou operador)
│   │       ├── eventos/        # CRUD de eventos / leilões
│   │       ├── leiloes/        # Importação de leilões (API RemateWeb)
│   │       │   └── detalhes/   # Detalhe do evento (EventoClient.tsx)
│   │       ├── operadores/     # CRUD de operadores
│   │       │   └── detalhes/   # Detalhe do operador (OperadorClient.tsx)
│   │       ├── escala/         # Escala geral de operadores
│   │       ├── financeiro/     # Resumo financeiro e cálculos
│   │       ├── exportacao/     # Exportação Excel / PDF
│   │       ├── configuracoes/  # Feriados, regras de pagamento
│   │       ├── minha-escala/   # Escala pessoal (operador)
│   │       ├── meus-pagamentos/# Pagamentos do operador
│   │       └── meu-perfil/     # Perfil do operador
│   ├── components/
│   │   └── CurrencyInput.tsx   # Input de valor monetário (R$)
│   ├── lib/
│   │   ├── auth-context.tsx    # Contexto de autenticação (Firebase + RemateWeb)
│   │   ├── firebase.ts         # Inicialização Firebase SDK
│   │   ├── firestore.ts        # Helpers Firestore (CRUD genérico)
│   │   └── masks.ts            # Máscaras de input (CPF, telefone, etc.)
│   ├── services/
│   │   ├── events.ts           # Service de eventos (Firestore)
│   │   ├── operators.ts        # Service de operadores (Firestore)
│   │   └── remateweb-api.ts    # Client da API RemateWeb (leilões, canais, estúdios)
│   └── types/
│       ├── event.ts            # Tipos: GestaoEvent, EventAssignment, EventExpense, etc.
│       ├── operator.ts         # Tipos: Operator, PaymentRules, HourRange
│       ├── payment.ts          # Tipos: PaymentCalculation, FinancialSummary, Holiday
│       └── html2pdf.d.ts       # Declaração de tipos para html2pdf.js
├── firebase.json               # Config Firebase Hosting
├── firestore.rules              # Regras Firestore
├── firestore.indexes.json       # Índices Firestore
├── next.config.ts               # Config Next.js (output: 'export')
├── tsconfig.json
└── package.json
```

---

## 🚀 Módulos

### 🔐 Autenticação
- Login via **Firebase Auth** (e-mail/senha) para operadores
- Login via **API RemateWeb** (OAuth token) para gestores
- Reset obrigatório de senha no primeiro acesso
- Perfis carregados do Firestore (`/users/{uid}`)

### 📊 Dashboard
- **Admin**: KPIs (total eventos, receita, despesas, operadores ativos), próximos eventos e alertas (eventos sem fechamento, sem equipe escalada)
- **Operador**: saudação personalizada, meus serviços (filtro dia/semana/mês), próximos eventos e tipo de contrato

### 📅 Eventos & Leilões
- Importação de leilões diretamente da API RemateWeb
- CRUD completo de eventos com campos: data, local, canal, tipo de operação (estúdio/externo), receita, observações
- Detalhes do evento com abas: informações, equipe, despesas, planejamento e fechamento
- Planejamento logístico: veículos, hotel, checklist e notas

### 👥 Operadores
- Cadastro de operadores com tipos de contrato: **Funcionário**, **Freelancer N1**, **Freelancer N2**
- Perfis: Operador ou Gestor
- Regras de pagamento personalizadas por operador (faixas de hora, valores dia útil vs. fim de semana)
- Detalhes do operador com histórico de eventos

### 📆 Escala
- Visão geral da escala de todos os operadores
- Escala pessoal para cada operador (calendário visual)
- Atribuição de operadores a eventos com datas de viagem

### 💰 Financeiro
- Resumo financeiro por período
- Cálculo automático de pagamentos baseado nas regras de contrato
- Controle de receitas, despesas e resultado líquido
- Detalhamento por operador

### 📤 Exportação
- Relatórios em **Excel** (`.xlsx`) via biblioteca `xlsx`
- Relatórios em **PDF** via `html2pdf.js`

### ⚙️ Configurações
- Cadastro de feriados (nacionais e estaduais)
- Regras de pagamento padrão por tipo de contrato
- Gerenciamento de estúdios

---

## 🏗 Pré-requisitos

- **Node.js** ≥ 18
- **npm** ≥ 9
- Projeto Firebase configurado (`gestaoops-7047e`)
- Variáveis de ambiente Firebase (configuradas em `src/lib/firebase.ts`)

---

## ⚡ Instalação & Desenvolvimento

```bash
# Clonar o repositório
git clone <url-do-repo>
cd gestao-ops

# Instalar dependências
npm install

# Rodar em modo desenvolvimento
npm run dev
```

O app estará disponível em `http://localhost:3000`.

---

## 🚢 Build & Deploy

O projeto utiliza **static export** do Next.js e é hospedado no **Firebase Hosting**.

```bash
# Gerar build estática (output → /out)
npm run build

# Deploy para Firebase Hosting
firebase deploy --only hosting
```

### Deploy Firestore Rules & Indexes

```bash
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

---

## 🔑 Autenticação Dual

O sistema suporta dois métodos de login:

1. **Firebase Auth** — Operadores fazem login com e-mail/senha criados pelo admin. No primeiro acesso, é obrigatório trocar a senha.
2. **RemateWeb API** — Gestores podem autenticar via credenciais da plataforma RemateWeb. O token é persistido no `localStorage` e um login anônimo no Firebase é feito em background para satisfazer as regras do Firestore.

---

## 🗃 Coleções Firestore

| Coleção | Descrição |
|---|---|
| `users` | Perfis de usuários (uid, name, email, role, contractType) |
| `events` | Eventos/leilões com assignments, expenses, closing e planning |
| `operators` | Cadastro de operadores com regras de pagamento |
| `holidays` | Feriados para cálculos de pagamento |
| `settings` | Configurações globais |

---

## 📜 Scripts Disponíveis

| Comando | Descrição |
|---|---|
| `npm run dev` | Inicia o servidor de desenvolvimento |
| `npm run build` | Gera o build estático em `/out` |
| `npm run start` | Serve o build de produção localmente |
| `npm run lint` | Executa ESLint no projeto |

---

## 📝 Licença

Projeto interno — uso restrito à equipe RemateWeb.
