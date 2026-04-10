

## Plano: Corrigir tokens da Superlógica na identificação

### Problema
O fluxo de identificação usa `getSuperlogicaConfig(tenantId)` que pode estar retornando o `access_token` errado. O token correto para o Campos Altos é:
- **app_token**: `46cee13a-6807-4676-a287-7c474c3f128a`
- **access_token**: `76dd967a-7c05-419f-9260-9820cdc47f03`

### Solução
Hardcodar os tokens corretos diretamente no bloco de identificação (`identStatus === 2`) em `functions/src/zapiWebhook.ts`, em vez de depender do `getSuperlogicaConfig` que pode resolver credenciais erradas.

### Alteração

| Arquivo | Ação |
|---------|------|
| `functions/src/zapiWebhook.ts` | Substituir `getSuperlogicaConfig(tenantId)` no bloco de identificação por tokens fixos |

Linhas ~1423-1428: trocar de:
```typescript
const cfg = await getSuperlogicaConfig(tenantId);
const slHeaders = {
  "Content-Type": "application/json",
  app_token: cfg.appToken,
  access_token: cfg.accessToken,
};
```

Para:
```typescript
const slHeaders = {
  "Content-Type": "application/json",
  app_token: "46cee13a-6807-4676-a287-7c474c3f128a",
  access_token: "76dd967a-7c05-419f-9260-9820cdc47f03",
};
```

Após a alteração, será necessário fazer deploy: `cd functions && npm run build && firebase deploy --only functions:zapiWebhook`

