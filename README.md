# ARC — Agenda Rock Cristão


Site estático (formulário + painel de geração de slides) com backend
serverless na Vercel, seguindo o mesmo padrão de infra já usado no Mappa
(GitHub org `evidentestudio`, time Vercel `pedro-ec15`, DNS no Registro.br).

## Estrutura

```
arc-site/
├── public/
│   └── agenda.html       → formulário + painel (front-end estático)
├── api/
│   ├── agenda.js         → função serverless (POST salva, GET lista, DELETE remove — com senha)
│   └── extract-agenda.js → função serverless (lê imagem de post com IA e devolve agendas — com senha)
└── package.json
```

## 1. Criar o banco (Upstash Redis)

Se você já tem uma instância do Upstash Redis usada no Mappa, pode reaproveitar
(basta usar um prefixo de chave diferente, já configurado como `arc:agendas`).
Senão, crie uma nova gratuita em https://upstash.com (mesmo fluxo que você já
conhece).

Anote:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

## 2. Subir o projeto pro GitHub

```bash
cd arc-site
git init
git add .
git commit -m "Site inicial do ARC"
gh repo create evidentestudio/arc-agenda-rock-cristao --private --source=. --push
```

(ou suba manualmente pelo GitHub Desktop / interface web, como preferir)

## 3. Importar na Vercel

1. No dashboard da Vercel (time `pedro-ec15`), clique em **Add New → Project**
2. Selecione o repositório `arc-agenda-rock-cristao`
3. Framework preset: **Other** (é só HTML estático + funções serverless, não
   precisa de build)
4. Em **Environment Variables**, adicione:
   - `UPSTASH_REDIS_REST_URL` → (valor do passo 1)
   - `UPSTASH_REDIS_REST_TOKEN` → (valor do passo 1)
   - `ARC_ADMIN_PASSCODE` → a senha que você quiser usar pra abrir o painel
     "Gerar slides" (essa fica só no servidor, nunca aparece no código do
     navegador — diferente da versão anterior)
   - `ANTHROPIC_API_KEY` → chave da API da Anthropic (console.anthropic.com),
     usada pelo botão "Importar de post (IA)" dentro do painel — sem ela,
     esse botão continua no ar mas retorna erro de servidor não configurado
5. Deploy

## 4. Apontar o domínio arc.evidenteprodutos.com.br

1. Na Vercel, dentro do projeto → **Settings → Domains** → adicione
   `arc.evidenteprodutos.com.br`
2. A Vercel vai te dar um registro CNAME (algo como `cname.vercel-dns.com`)
3. No Registro.br, no DNS do domínio `evidenteprodutos.com.br`, crie um
   registro CNAME:
   - Nome: `arc`
   - Valor: o CNAME que a Vercel te passou
4. Aguarde a propagação (geralmente de minutos a algumas horas) e o SSL é
   emitido automaticamente pela Vercel

## O que mudou em relação à versão anterior (artifact do claude.ai)

- O `window.storage` (que só funciona dentro do claude.ai) foi substituído
  por chamadas `fetch('/api/agenda')` para a função serverless
- Os dados agora ficam no Redis, fora do claude.ai — nada de depender de
  login numa conta Claude
- A senha do painel "Gerar slides" agora é validada **no servidor**. O
  navegador nunca guarda nem expõe a senha certa — diferente da versão
  anterior, em que a senha ficava visível no código-fonte do HTML
- O visual, os textos, a lógica de agrupar por estado e a geração da imagem
  do slide continuam exatamente iguais

## Testado localmente

O fluxo completo (cadastro → validação → painel com senha → agrupamento por
estado → geração do slide) foi testado ponta a ponta com um servidor local
simulando a API real antes da entrega. Falta só o teste em produção, já com
o Redis e o domínio de verdade.
