

## Plano: Tornar o bot conversacional, empático e com funil natural

### Problema atual
O bot é rígido — responde com menu numerado (1-4) e respostas fixas. Não há conversa fluida, empatia, nem funil para entender o que o cliente quer.

### Estratégia
Remover as respostas hardcoded do menu e da saudação, e delegar **tudo** para a IA (Gemini), com um system prompt rico que instrui o bot a ser conversacional, empático e usar um funil natural. O menu só aparece quando o cliente pedir ou quando fizer sentido no contexto.

### Alterações

| Arquivo | Ação |
|---------|------|
| `functions/src/zapiWebhook.ts` | Reescrever o system prompt e remover respostas rígidas |

**1. Reescrever o system prompt (linha ~2826-2833)**

Substituir o prompt atual por um novo que instrui o bot a:
- Ser empático, acolhedor, usar linguagem natural
- Não despejar menu logo de cara — primeiro entender o que o cliente precisa
- Usar um funil: saudar → perguntar como pode ajudar → entender a necessidade → direcionar
- Ser flexível: aceitar linguagem coloquial, abreviações, áudios transcritos
- Manter tom humano, como se fosse um concierge do condomínio
- Só apresentar opções numeradas quando o cliente pedir "menu" ou quando for útil para escolha
- Incluir contexto do morador (nome, bloco, unidade) de forma natural na conversa

**2. Remover a saudação hardcoded com menu (linhas ~2489-2532)**

O bloco `greetLike` que detecta "oi/olá/bom dia" e retorna menu fixo será removido. Essas saudações passarão direto para a IA, que responderá de forma natural e empática.

**3. Simplificar `maybeHandleMenu` (linhas ~2473-2482)**

Manter apenas o tratamento de boletos (opção 1) que faz busca real na Superlógica. As opções 2, 3 e 4 passarão para a IA responder de forma conversacional em vez de respostas fixas.

**4. Atualizar fallbacks de erro (linhas ~2874-2887)**

Trocar os fallbacks de menu rígido por mensagens mais naturais como "Desculpe, tive um probleminha. Pode repetir o que precisa?"

### Novo system prompt (resumo)

```
Você é o Síndico X, assistente virtual do Condomínio Campos Altos. 
Sua personalidade: acolhedor, empático, prestativo, como um concierge dedicado.

REGRAS DE INTERAÇÃO:
- Cumprimente de forma calorosa e natural, usando o nome do morador
- NÃO despeje menu numerado logo de cara — pergunte como pode ajudar
- Use um funil natural: entenda primeiro, direcione depois
- Seja flexível com linguagem coloquial, gírias, abreviações
- Quando o cliente disser o que precisa, ajude diretamente
- Só apresente opções numeradas se o cliente pedir "menu" ou se for útil
- Mantenha respostas curtas e naturais, como uma conversa de WhatsApp
- Use emojis com moderação
- Você pode ajudar com: boletos, reservas, convenção/regimento, contato com administração

Contexto do morador: {nome}, Bloco {bloco}, Apt {unidade}
```

### Impacto
O bot deixa de ser um menu interativo e passa a ser um assistente conversacional que entende o contexto e guia o morador naturalmente.

