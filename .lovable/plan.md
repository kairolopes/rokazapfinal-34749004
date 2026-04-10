

## Diagnóstico e Plano de Otimização

### Causa raiz dos dois problemas

O arquivo `zapiWebhook.ts` tem **2808 linhas** e executa tudo de forma **síncrona e sequencial** dentro de uma única requisição HTTP. Quando uma mensagem chega:

1. **Demora para aparecer no sistema**: O webhook só responde `200 OK` na linha 931, **depois** de executar toda a lógica de auto-cadastro (que faz chamadas à API Superlógica — linhas 547-871) e a resposta da IA. A Z-API pode interpretar a demora como falha e retentar, causando duplicatas ou atrasos.

2. **Demora/falha da IA**: A função `handleChatbotAutoReply` (linhas 1067-2808) é extremamente pesada:
   - Faz múltiplas queries ao Firestore para resolver config (~5-10 queries)
   - Busca contato com varredura bruta de até 20k docs (linhas 1844-1920)
   - Chama a API da Superlógica (múltiplas páginas) para buscar boletos
   - Só depois chama OpenAI/Dialogflow/Vertex
   - Cloud Functions tem timeout de 60s (padrão) — facilmente estourado

### Plano de otimização (3 mudanças)

#### 1. Responder `200 OK` imediatamente e processar IA em background
Separar o webhook em duas fases:
- **Fase 1 (síncrona, < 2s)**: Gravar mensagem no Firestore, atualizar conversa, responder `200 OK`
- **Fase 2 (assíncrona)**: Auto-cadastro Superlógica + resposta IA

Isso resolve o problema 1 (mensagem aparece rápido) e evita timeout da Z-API.

**Implementação**: Mover a chamada `handleChatbotAutoReply` e o bloco de auto-cadastro para **depois** do `res.status(200).send("OK")`, usando um pattern de "fire and forget" com Promise (sem await no res).

```text
zapiWebhook flow (antes):
  receive → dedupe → resolve owner → find/create conv → auto-cadastro → save msg → update conv → AI reply → res.200

zapiWebhook flow (depois):
  receive → dedupe → resolve owner → find/create conv → save msg → update conv → res.200
  └── background: auto-cadastro + AI reply
```

#### 2. Aumentar timeout da Cloud Function
Configurar `zapiWebhook` com `timeoutSeconds: 300` e `memory: "1GB"` para dar margem à IA e às chamadas Superlógica que rodam em background.

#### 3. Cache de contato para evitar varreduras brutas
O `tryFindContact` e o `scanForCpf` fazem varreduras de até 20k documentos por mensagem. Adicionar um cache simples em memória (Map global) com TTL de 5 minutos para o mapeamento `phone → contactData`, evitando queries repetidas no mesmo cold start.

### Arquivos alterados
- `functions/src/zapiWebhook.ts` — reestruturar para responder 200 antes da IA; aumentar timeout/memory; adicionar cache de contato

