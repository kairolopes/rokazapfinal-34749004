

## Plano: Usar nome do WhatsApp na identificação

### Problema
O bot está chamando o cliente pelo nome cadastrado na Superlógica (ex: nome do proprietário/morador), mas deveria usar o nome que aparece no WhatsApp do cliente (`body.senderName`).

### Alterações

| Arquivo | Ação |
|---------|------|
| `functions/src/zapiWebhook.ts` | 3 pontos de alteração no bloco de identificação |

**1. Capturar o nome do WhatsApp (antes da busca, ~linha 1416)**
```typescript
const whatsappName = body.senderName || body.chatName || "";
```

**2. Salvar o nome do WhatsApp na conversa ao encontrar match (~linha 1469-1474)**
Adicionar `identWhatsappName: whatsappName` ao update do Firestore.

**3. Usar o nome do WhatsApp na mensagem de confirmação (~linha 1475-1478)**
Trocar `foundMatch.name` por `whatsappName || "morador"` na saudação.

**4. Usar o nome do WhatsApp no menu pós-confirmação (~linha 1394)**
Trocar:
```typescript
const firstName = (convData?.identName || "").split(/\s+/)[0] || "";
```
Por:
```typescript
const firstName = (convData?.identWhatsappName || convData?.identName || "").split(/\s+/)[0] || "";
```

Isso garante que o bot sempre chame o cliente pelo nome que ele usa no WhatsApp, não pelo nome cadastrado na Superlógica.

