# Dayline Review 0.6.6

- Compatibilidade com o link único de projetos compartilhados do Dayline 0.6.6.
- Seletor de integrantes com foto/nome e indicador de nova prévia aguardando feedback.
- Troca de integrante altera o vídeo sem trocar a URL.
- Rascunho local é protegido por confirmação antes de trocar de integrante.
- Feedback compartilhado é enviado por `dayline_collab_preview_submit_feedback` para o `preview_id` selecionado.
- Contagem de alterações usa `items + paths`, alinhada ao contrato SQL do site.
- Depois da confirmação do servidor, o indicador de aguardando feedback some do integrante selecionado.
- IDs de envio são separados por prévia, evitando colisão ao mandar o mesmo conteúdo para integrantes diferentes.
- Links individuais antigos continuam funcionando pelo fluxo legado (`x-preview-key`).
- `contracts/shared-preview-feedback.sql` adiciona a checagem do documento v2 e o helper público para reconhecer projetos sem vídeo enviado.
