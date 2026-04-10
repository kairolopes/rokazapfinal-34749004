

## Plano: Sistema de Identificação por Variável de Controle

### O que muda

Substituir o sistema de auto-cadastro atual por um fluxo baseado em uma **variável de controle numérica** (`identStatus`) armazenada na conversa no Firestore. O nome do condomínio muda para **Campos Altos** (não "Campos Verdes" como mencionado — usando o nome real conforme configuração existente).

### Fluxo

```text
Nova mensagem recebe → verifica identStatus na conversa

identStatus = 1 (identificado):
  → Responde com menu:
    "Olá, {nome}, sua conta está vinculada ao apartamento {id_unidade_uni},
     bloco {st_bloco_uni}, do CONDOMÍNIO CAMPOS ALTOS!
     1 - Boletos  2 - Reserva  3 - Convenção  4 - Administração"
  → Processa comandos 1-4 normalmente

identStatus = 2 (não identificado, valor padrão):
  → Busca na Superlógica: GET /unidades/index?idCondominio=47
    páginas 1 a 5, com exibirDadosDosContatos=1
  → Pega os 5 últimos dígitos do telefone do cliente
  → Compara com todos os telefones retornados nos arrays de contatos
  → Se encontrar match:
    → Extrai id_unidade_uni e st_bloco_uni
    → Responde: "Olá! Sou o Síndico X do Condomínio Campos Altos.
      Seu nome é {nome}? Você está vinculado ao Bloco {bloco},
      Apartamento {unidade}?"
    → Aguarda resposta "sim" → grava identStatus = 1
  → Se NÃO encontrar:
    → "Não consegui identificar seu cadastro. Entre em contato
      com a administração para se cadastrar."
    → Não responde mais perguntas (bloqueia até identificação)
```

### Dados armazenados na conversa

Campos adicionados ao documento `conversations/{id}`:
- `identStatus`: número (1 = identificado, 2 = não identificado)
- `identUnitId`: string (id_unidade_uni da Superlógica)
- `identBlock`: string (st_bloco_uni)
- `identName`: string (nome do contato encontrado)
- `identPendingConfirm`: boolean (aguardando "sim" do cliente)

### Alterações técnicas

| Arquivo | Ação |
|---------|------|
| `functions/src/zapiWebhook.ts` | Reescrever `handleChatbotAutoReply` para usar variável de controle |

#### Detalhes da implementação no webhook:

1. **No início de `handleChatbotAutoReply`**: ler `identStatus` da conversa (default = 2)

2. **Se `identStatus === 2` e `identPendingConfirm === true`**: verificar se a mensagem é "sim"/"s"/"yes" → gravar `identStatus = 1`, responder com menu

3. **Se `identStatus === 2`**: executar busca na Superlógica com endpoint fixo `idCondominio=47`, páginas 1-5, 50 itens/página. Comparar 5 últimos dígitos do telefone. Se match → salvar dados e perguntar confirmação. Se não → orientar a entrar em contato com administração.

4. **Se `identStatus === 1`**: responder com menu personalizado e processar comandos normalmente (boletos, reservas, etc.)

5. **Remover** a lógica atual de auto-cadastro de contatos na Superlógica (o `findInSuperlogica` no background work). O cadastro de contatos no Firestore não é mais necessário para o fluxo do chatbot.

### Observação importante

O nome "Síndico X" e "Condomínio Campos Altos" serão usados conforme solicitado. O "Campos Verdes" mencionado na sua mensagem parece ser um erro de digitação — o tenant existente é **Campos Altos** (condominioId 47). Se quiser usar "Campos Verdes", confirme.

