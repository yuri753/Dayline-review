# Recebimento de feedback no Dayline

O botão **Feedback do cliente** aparece em cada comissão. Um indicador **Novo** aparece quando há um envio ainda não aberto neste dispositivo. O app consulta novos pedidos a cada minuto enquanto está visível e ao voltar para ele. Abrir o botão busca o canvas mais recente; **Atualizar** repete a consulta. O canvas do cliente tem navegação e zoom e não substitui o quadro de trabalho do projeto.

## Quando publicar o site

1. Publique `index.html`, `review.css`, `review.js`, `review-config.json` e a pasta `feedback/` juntos em uma hospedagem HTTPS. Não publique `integration-staging/`, credenciais do app ou `.env`.
2. No app, abra **`G:\Dayline\src\commission-preview\review-site.js`**. Na linha marcada **COLE O LINK DO SITE PUBLICADO AQUI**, substitua as aspas vazias pelo endereço que abre este `index.html`. Reinicie o ambiente de desenvolvimento ou gere uma nova versão do app após a alteração.
3. No SQL Editor do mesmo projeto Supabase do app, execute `contracts/feedback-envios.sql` (também disponível em `G:\Dayline\supabase\migrations\20260913_feedback_envios.sql`). Requer as tabelas e políticas de `setup-remote.sql`. Não é necessário apagar ou alterar os quadros v1 existentes. **Esta migração ainda não foi aplicada ao banco remoto por esta implementação.**
4. No app, use **Compartilhar prévia → Gerar link**. O endereço inclui `?key=...`, que identifica e autoriza o acesso à comissão. Abra esse link no site, crie pedidos e clique em **Enviar pedidos de ajuste**. O site só confirma o envio depois da resposta do servidor.

`review-config.json` contém apenas URL e chave pública anon do Supabase, copiadas da configuração existente do app. Caso mude de projeto Supabase, atualize esses dois campos também. Nunca coloque a chave administrativa ou as credenciais B2 nesse arquivo.

## Dados e limites

- Notas, comentários, imagens, prints com tempo do vídeo, links, cores, estilos, desenhos e conexões são enviados no formato v2 compartilhado em `feedback/contract.js`.
- Cada envio é uma cópia imutável em `feedback_envios`, vinculada à comissão. Novos envios não apagam os anteriores; a interface exibe o mais recente.
- As imagens raster seguem embutidas no documento, com limite total de **5 MB por envio**. Acima disso, o site pede para reduzir as imagens e mantém o quadro aberto. Não há upload adicional de imagens para B2.
- O rascunho do site continua em memória: recarregar antes de enviar perde os ajustes. O envio confirmado fica salvo no banco.
- A chave da prévia e o indicador de leitura ficam no dispositivo. Chaves antigas não presentes no dispositivo precisam ser recuperadas pelo fluxo já existente do projeto.
- A integração reutiliza a autorização `x-preview-key`: somente quem possui a chave acessa os envios daquela comissão. A migração concede leitura e criação, sem edição/exclusão dos envios para clientes da API.

## Verificação após ativar

Envie uma nota com uma imagem de teste, confira a confirmação no site, abra a comissão no app e verifique o indicador Novo e o canvas. Envie outra revisão e confira que o aviso reaparece. Teste também falha de rede: o site deve informar erro e conservar o quadro, sem afirmar que enviou.


## Dayline 0.6.6 — equipes e link único

Para projetos compartilhados, execute também `contracts/shared-preview-feedback.sql` depois de `UPDATE_TO_0.6.6.sql`. O link é único por projeto e usa o token público de `dayline_collab_preview_links`; ele não usa `x-preview-key`. O site chama `dayline_collab_preview_public`, cria uma aba por integrante que já enviou vídeo e envia o feedback da aba selecionada para `dayline_collab_preview_submit_feedback`.

O indicador na foto significa que a revisão atual daquele integrante ainda aguarda feedback. Ele some somente depois que o Supabase confirma o envio. O backend associa o feedback ao `preview_id` selecionado, então o retorno de um integrante não é exposto como feedback de outro.

Os links individuais antigos continuam funcionando pelo fluxo legado com `x-preview-key`.
