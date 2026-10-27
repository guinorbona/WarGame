# Servidor de sala — WAR

O site continua no GitHub Pages. Este serviço conecta os jogadores por HTTPS/WebSocket, sem depender de uma conexão direta entre suas redes ou de STUN/TURN. O anfitrião continua validando as jogadas e filtrando as informações individuais. O serviço recebe as mensagens em trânsito; utilize uma implantação sob seu controle. Não há banco de dados ou gravação das partidas/mensagens.

## Publicar

1. Abra [Deploy to Render](https://render.com/deploy?repo=https://github.com/guinorbona/WarGame), entre na sua conta e revise o serviço definido no `render.yaml` da raiz. Revise o plano antes de confirmar; a disponibilidade do plano gratuito depende do provedor.
2. Confirme a criação. Aguarde o status **Live** e copie a URL HTTPS fornecida pelo Render.
3. No jogo, abra **Criar uma sala → Servidor de sala · redes diferentes**, cole essa URL e crie **uma nova sala**.
4. Use **Copiar link de convite**. Os convidados recebem o endereço do servidor pelo próprio link.

Não é preciso fornecer chaves de API ao jogo. O endereço é lembrado neste navegador. Salas diretas antigas não migram: crie outra sala. Se o serviço gratuito estiver adormecido, aguarde sua inicialização e use **Alterar conexão / tentar novamente**.

Para fazer esse servidor ser o padrão para todos, crie a variável pública de repositório **VITE_RELAY_URL** em **GitHub → Settings → Secrets and variables → Actions → Variables**, com a URL HTTPS, e execute o workflow **Publicar no GitHub Pages**. O endereço é público, não uma credencial. O campo no jogo permite escolher outro endereço ou voltar ao modo direto.

## Executar localmente

Na raiz do repositório, com Node.js 22+:

```sh
npm ci
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173 PORT=3001 node server/index.js
```

Use `http://localhost:3001` no formulário do jogo local. Fora de localhost, o cliente exige HTTPS/WSS; o proxy do provedor encerra o TLS e encaminha a conexão para `PORT`.

- **PORT:** porta HTTP/WebSocket, padrão 3001.
- **ALLOWED_ORIGINS:** origens exatas separadas por vírgula; padrão `https://guinorbona.github.io`. Para domínio próprio, inclua a origem dele, sem caminho como `/WarGame`.
- **GET /health:** responde `{"ok":true}`.
- **WebSocket /relay:** registro de identidade e encaminhamento dos canais.

## Validação e operação

`npm test` inclui WebSockets reais, sincronização privada, reconexão, rejeição de origem e tentativa de envio por outro participante. `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e -- -g 'WebSocket relay'` testa anfitrião e convidado no navegador, sem WebRTC e sem remover políticas de rede.

As salas são temporárias e o anfitrião precisa manter a aba aberta. Após reinício do serviço, os navegadores tentam reconectar; convidados podem precisar reentrar pelo mesmo convite e navegador. Não há migração de anfitrião nem recuperação após ele fechar a aba.

Limites: cinco canais de convidados por sala, 500 conexões por processo, mensagens de 64 KiB, fila de saída de 256 KiB e 120 mensagens por segundo por conexão. Um heartbeat limpa conexões encerradas. Remetentes ficam vinculados à conexão e apenas as duas pontas do canal podem enviar nele. Essas proteções não são autenticação por conta nem SLA. Use uma única instância: o registro de salas é mantido em memória, sem distribuição entre réplicas.
