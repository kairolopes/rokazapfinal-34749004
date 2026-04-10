

## Plano

### 1. Corrigir erro de build em MessageBubble.tsx
Linha 32: substituir `conv?.lastMessageBody` por `conv?.lastMessage?.body` (o tipo `Conversation` não tem `lastMessageBody`).

### 2. Salvar configuração Z-API do Campos Altos no Firestore
Criar/atualizar o documento `zapi_config/AyGEjmRvU1bQiKQruiiE` com os dados:

```
{
  instanceId: "3ECD22ED86FE925D5A7772442EF70706",
  instanceToken: "9D350B8542F495AC919995C1",
  clientToken: "Ff94d05bcd8b546afb957fc52d8e33ebaS",
  apiUrl: "https://api.z-api.io",
  tenantId: "AyGEjmRvU1bQiKQruiiE",
  ownerId: "AyGEjmRvU1bQiKQruiiE"
}
```

Isso será feito via a função `setupAmoConfig` existente ou através de um script/chamada direta ao Firestore Admin na edge function. O resultado: todas as mensagens recebidas na instância `3ECD22ED86FE925D5A7772442EF70706` serão roteadas para o tenant Campos Altos.

### Arquivos alterados
- `src/components/chat/MessageBubble.tsx` — correção de tipo (linha 32)
- Edge function ou script para persistir o documento no Firestore

