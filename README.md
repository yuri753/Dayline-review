# Dayline Review

Sirva esta pasta por HTTP/HTTPS para usar a integração com o app. Veja `FEEDBACK-SETUP.md` para publicação, configuração do link e ativação do recebimento no Supabase. Ao abrir um link de comissão, o site consulta o vídeo associado àquela prévia.

Em telas maiores que 980px, o player fica à esquerda e o canvas à direita. Em telas menores, o player fica acima do quadro. O botão “Comentar este momento” pausa o vídeo e captura o frame em um cartão `print`, com `videoTime` em segundos e título em mm:ss. Clicar no tempo do cartão volta àquele trecho. O print e o comentário são uma única etapa de criação no histórico.

O player usa `crossorigin="anonymous"`. Vídeos externos devem responder com `Access-Control-Allow-Origin` adequado (inclusive no armazenamento/CDN). Sem CORS, ou sem um frame carregado, a página informa o erro e não cria um print falso. A captura usa JPEG com lado máximo de 1600px, sem upload automático.

Selecionar um cartão mostra os controles de fonte, tamanho (8–72), negrito, itálico, sublinhado, alinhamento, cor do texto e fundo. Notas/comentários têm `textStyle`; imagens/prints têm `imageTitleStyle` e `annotationStyle` independentes. Links têm título editável. A fonte digitada precisa estar disponível no navegador; “Fontes do dispositivo” aparece somente quando `queryLocalFonts` existe e requer permissão. A formatação aplica-se ao campo inteiro, como no modelo de campos do app, e participa do desfazer/refazer.

O envio usa o contrato v2 em `feedback/contract.js` e a tabela `feedback_envios`. Ele preserva estilos e imagens raster embutidas, com limite de 5 MB por envio. O contrato e a tabela `feedback_canvas` v1 continuam separados e não recebem esse conteúdo.

O rascunho do quadro usa apenas memória: fechar/recarregar perde as alterações ainda não enviadas. O envio confirmado fica salvo no Supabase e pode ser aberto no app. Inclui notas, comentários, imagens, links HTTP(S), cores, desenho, conexões, movimento, redimensionamento e histórico. Não inclui tarefas, checklists ou cartões de vídeo.

`feedback/site.js` escuta `dayline:submit-adjustments`, valida o conteúdo e envia ao Supabase com a chave da prévia. A confirmação só aparece após o servidor salvar o envio. Falhas preservam o rascunho, e uma nova tentativa do mesmo conteúdo reutiliza o identificador para evitar duplicação. O app mostra novos pedidos no botão Feedback do cliente e permite abrir o canvas com navegação e zoom. A migração SQL precisa ser aplicada antes de usar a integração.

Arraste o fundo para navegar, use a roda para zoom. Arraste o cabeçalho dos cartões para movê-los e o canto inferior direito para redimensionar. Conectar exige clicar em dois cartões. Ctrl+Z desfaz e Ctrl+Shift+Z refaz quando o quadro tem foco. Delete remove o elemento selecionado. Em campos de texto, os atalhos nativos do editor são preservados.

Esc cancela um gesto ou uma conexão pendente. Arrastes cancelados restauram o estado inicial sem consumir o histórico. O botão de porcentagem enquadra todos os cartões e desenhos. Uma conexão selecionada pode ser removida com o botão × da barra inferior. A ferramenta Desenhar permite desenhar passando pelos cartões; use Selecionar para editar os textos.

## Prévias compartilhadas — Dayline 0.6.6

Quando o link usa o token público de um projeto compartilhado, o site consulta `dayline_collab_preview_public` e mostra apenas os integrantes que já enviaram uma prévia. Todos usam o mesmo link. Cada botão de integrante mostra foto/nome, a revisão atual e um indicador quando aquela prévia ainda aguarda feedback.

Trocar de integrante muda o vídeo sem trocar a URL. Se houver um rascunho não enviado no quadro, o site pede confirmação antes de limpá-lo. O envio usa `dayline_collab_preview_submit_feedback`, vincula o canvas ao `preview_id` selecionado e mantém o feedback privado no backend. Depois que o servidor confirma o envio, o indicador de “aguardando feedback” daquele integrante some localmente.

Links individuais antigos continuam usando `chaves_acesso`, `comissao_videos` e `feedback_envios`. Para a experiência compartilhada completa, execute também `contracts/shared-preview-feedback.sql` depois do `UPDATE_TO_0.6.6.sql` do aplicativo.
