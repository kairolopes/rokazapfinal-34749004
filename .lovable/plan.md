

## Plano: Tornar a confirmação de identidade flexível e conversacional

### Problema
Quando o bot pede confirmação de identidade (bloco/apartamento), ele só aceita exatamente "sim" ou "não". Qualquer outra resposta (como "isso mesmo", "sou eu", "tá certo", "pode ser", "é isso aí") gera a mesma resposta travada: *"Por favor, responda sim ou não"*. Isso frustra o cliente.

### Solução
Em vez de aceitar apenas regex rígido, enviar a mensagem do cliente para a IA com um prompt específico que classifica a intenção como "confirmação", "negação" ou "dúvida", e agir de acordo. Isso permite que o bot entenda respostas naturais.

### Alterações

| Arquivo | Ação |
|---------|------|
| `functions/src/zapiWebhook.ts` | Expandir patterns de sim/não e adicionar fallback inteligente |

**1. Expandir os padrões de aceitação (linha ~1387-1388)**

Trocar os regex atuais por versões muito mais abrangentes:

```typescript
// Aceitar variações naturais de "sim"
const yesPattern = /^(sim|s|yes|y|isso|confirmo|correto|exato|é isso|sou eu|tá certo|ta certo|pode ser|é isso aí|isso mesmo|isso ai|certinho|certo|aham|uhum|positivo|com certeza|claro|ok|blz|beleza|bora|vamos|é esse|é essa|meu mesmo|minha mesmo|esse mesmo|essa mesma|perfeito|show)\b/i;

// Aceitar variações naturais de "não"  
const noPattern = /^(n[aã]o|no|n|errado|incorreto|nao é|não é|tá errado|ta errado|errei|engano|outro|outra|nope|negativo|nem|nunca|de jeito nenhum|não sou|nao sou)\b/i;
```

**2. Trocar o fallback rígido por resposta empática (linha ~1413)**

Em vez de repetir "responda sim ou não", o bot vai reformular de forma natural:

```typescript
} else {
  // Resposta não reconhecida — reformular de forma amigável
  const identBlk = convData?.identBlock || "—";
  const identUnit = convData?.identUnitId || "—";
  replyText = 
    `Desculpa, não entendi 😅\n\n` +
    `Só preciso confirmar: você mora no *Bloco ${identBlk}*, *Apartamento ${identUnit}*?\n\n` +
    `Pode responder *sim* ou *não* 😊`;
}
```

**3. Trocar o menu pós-confirmação por resposta conversacional (linhas ~1397-1403)**

Após o "sim", em vez do menu numerado, usar uma saudação empática:

```typescript
replyText =
  `Que bom, *${firstName}*! Sua conta está vinculada ao apartamento ${identUnit}, bloco ${identBlk}, do *Condomínio Campos Altos* ✅\n\n` +
  `Como posso te ajudar hoje? 😊`;
```

### Impacto
- O bot aceita dezenas de variações naturais de "sim" e "não"
- Se ainda não entender, reformula de forma simpática em vez de repetir a mesma frase
- Após confirmação, entra direto em modo conversacional em vez de despejar menu

