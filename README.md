# Contrato único: quadro de feedback v1

`feedback-canvas.v1.schema.json` é o contrato de intercâmbio entre Dayline Review, Supabase e Dayline. `feedback-canvas.v1.example.json` mostra todos os quatro tipos. O formato não depende do estado interno de nenhum canvas.

## Regras

- `versao`: exatamente 1. Mudanças incompatíveis exigem outra versão.
- `blocos`: até 5.000. Cada bloco tem `id`, `tipo`, `x`, `y`, `largura`, `altura` e `conteudo`.
- Tipos: `nota` (`texto` simples, nunca HTML); `imagem` (`url`, `descricao` opcional); `link` (`url`, `titulo` opcional); `print` (`url`, `tempo_video_segundos`, `descricao` opcional).
- Print é uma imagem capturada do vídeo, acompanhada do instante em segundos, não um cartão de vídeo.
- `conexoes`: até 10.000; cada conexão tem `id`, `origem` e `destino`, referenciando IDs de blocos existentes e diferentes. IDs são únicos no documento inteiro; use `crypto.randomUUID()` para novos elementos.
- Posições são coordenadas do mundo em pixels a zoom 1, aceitando valores negativos. Tamanho é preservado entre os clientes. Pan e zoom são preferências locais de visualização e não fazem parte do documento compartilhado.
- Imagens/prints usam URLs HTTPS; antes de enviar, faça upload da imagem. Não armazenar `blob:`, caminhos Windows ou base64 neste JSON. As URLs devem ser estáveis; URLs assinadas que expiram precisam ser renovadas pelo serviço de mídia. O consumidor deve validar URLs antes de navegar/carregar e não deve buscar endereços arbitrários em um backend sem proteção contra SSRF.
- V1 contém somente os quatro tipos solicitados. Comentários podem virar notas. Desenhos e cores não possuem representação própria nesta versão: a futura integração deve oferecer conversão explícita (por exemplo, rasterizar um desenho como imagem), nunca descartá-los silenciosamente.

## Supabase

Execute `supabase/migrations/20260912_feedback_canvas.sql` no SQL Editor do projeto remoto **uma vez**, depois da configuração anterior de `chaves_acesso`. O script cria a extensão `pg_jsonschema`, valida o documento, rejeita IDs duplicados/referências inválidas e configura RLS. Uma reaplicação acusa tabela existente e desfaz a transação, sem apagar dados. Não foi executado remotamente nesta alteração.

Tabela `feedback_canvas`: `id uuid`, `id_comissao text unique` (FK de `chaves_acesso`), `quadro jsonb`, `revisao bigint`, `criado_em` e `atualizado_em`. Há um quadro atual por comissão; a revisão não é um histórico de submissões. O banco gera identidade/datas/revisão. Limite do documento: 5 MiB.

Para criar, enviar `{ "id_comissao": "...", "quadro": <documento v1> }` por POST. Para atualizar, usar PATCH com `{ "quadro": <documento v1> }`, filtrando pelo ID e pela revisão lida (`id=eq.…&revisao=eq.1`) e solicitando `Prefer: return=representation`. Se voltar zero linhas, recarregar e tratar conflito; não sobrescrever cegamente. A revisão aumenta a cada UPDATE.

Todas as requisições exigem a configuração pública do Supabase e `x-preview-key` com a chave da comissão. O portador da chave pode ler/criar/editar seu quadro; não pode apagá-lo ou transferi-lo. As políticas permissivas `true` ficam limitadas pela política restritiva `feedback_canvas_chave`.

## Compatibilidade verificada no código atual

O **app ainda precisa de adaptador e carregamento remoto**. `src/workspace-model.js::validateBoard` exige `{version,background,camera,items}`; blocos usam `kind`, `w`, `h`, `text`, `color`. Conexões são itens `kind: "line"` com `from`, `to`, `x2`, `y2`, não uma lista separada. `print` não é um tipo interno. Imagens remotas HTTPS não passam pelo validador atual: é necessário importar a mídia de forma controlada e gerar `mediaPath` ou imagem embutida aceita pelo app. `src/board-storage.js` carrega os quadros locais via `board_load`; não busca `feedback_canvas`.

O site também precisa de um serializador: hoje emite `{version,items,paths,videoTime}` e mantém imagens como data URLs. O fluxo futuro será: upload de imagens → conversão para v1 → gravação na tabela → leitura e validação no app → conversão para o modelo interno e importação da mídia. Os adaptadores devem preservar os IDs e tratar conteúdo não suportado explicitamente. Esta alteração define o contrato e a tabela, não modifica os renderizadores nem declara a integração pronta.

Para regenerar o JSON Schema e o SQL a partir da definição única: `node contracts/build-feedback-contract.mjs`. Fonte do SQL: `feedback-canvas.sql.template`. Não editar o schema embutido no SQL manualmente.

Referência: https://supabase.com/docs/guides/database/extensions/pg_jsonschema
