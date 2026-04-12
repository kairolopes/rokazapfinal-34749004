

## Plano: Resetar conversas para reiniciar identificação

### O que será feito
Criar uma Cloud Function callable que reseta todas as conversas do tenant Amo Condomínio (`AyGEjmRvU1bQiKQruiiE`), limpando os campos de identificação para que todos os clientes passem pelo fluxo novamente.

### Alterações

| Arquivo | Ação |
|---------|------|
| `functions/src/resetConversations.ts` | Nova função callable para resetar conversas |
| `functions/src/index.ts` | Exportar a nova função |

**1. Criar `resetConversations.ts`**

Função que busca todas as conversas do tenant e reseta os campos:
- `identStatus` → 2 (não identificado)
- Remove `identPendingConfirm`, `identName`, `identWhatsappName`, `identUnitId`, `identBlock`, `identCondoName`
- Limpa o histórico de mensagens da subcoleção `messages` (opcional, dependendo se quer que o cliente veja histórico)

```typescript
// Busca conversations where tenantId == "AyGEjmRvU1bQiKQruiiE"
// Para cada uma, faz update resetando identStatus para 2
// e deletando os campos de identificação
```

**2. Exportar em `index.ts`**

Adicionar o export da nova função.

**3. Executar a função**

Após deploy, chamar a função uma vez para resetar todas as conversas. Depois os clientes que enviarem mensagem passarão pelo fluxo de identificação do zero.

### Alternativa mais rápida
Se preferir, posso simplesmente adicionar um botão na página de Settings que chama essa função, ou posso criar um script direto que roda no Firebase Admin SDK.

