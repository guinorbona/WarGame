# WAR — Mesa de comando

Aplicação web independente de conquista territorial, em português, inspirada nas mecânicas clássicas de WAR. Interface responsiva, mapa SVG original com 42 territórios, 3–6 participantes, campanha solo e salas on-line com convite.

Projeto de fãs, sem vínculo com a Grow. Não utiliza imagens, logotipos ou digitalizações do tabuleiro oficial. A identidade visual é uma central militar moderna, com tipografia condensada, painéis táticos e mapa geográfico. Os contornos vêm do Natural Earth (domínio público); as divisões estratégicas são esquemáticas e as fronteiras válidas continuam sendo as conexões definidas em `src/world.js`.

## Jogar

- **Solo:** escolha a quantidade de adversários automáticos. A campanha é salva automaticamente no armazenamento local do navegador. Use **Continuar minha campanha salva** para recuperar o progresso.
- **On-line:** crie uma sala, copie o convite e compartilhe com seus amigos. Complete a mesa com robôs se desejar. O anfitrião inicia quando todos estiverem conectados, com 3 a 6 participantes no total.
- Selecione um território ou seu marcador para reforçar, atacar um vizinho ou remanejar. O botão **Rotas** exibe as conexões do mapa. Selecione os alvos no mapa ou na lista. Use **+ / − / 100%** para ajustar a escala, arraste o mapa com o mouse ou deslize no celular. Também é possível focar o mapa e usar as setas do teclado. Marcadores e linhas-guia tornam as regiões menores selecionáveis.
- A aba **Missão** revela seu objetivo, **Cartas** permite trocas e **Diário** mostra as jogadas. O botão **Como jogar** abre o manual completo.

## Regras implementadas

- Objetivos secretos de continentes, 24 territórios, 18 territórios com 2 exércitos ou eliminação de uma cor. Eliminar exige dar o golpe final; alvo ausente, próprio ou eliminado por terceiros transforma a missão em 24 territórios.
- Reforços de metade dos territórios, arredondados para baixo, com mínimo de 3. Bônus continentais: América do Norte 5, América do Sul 2, Europa 5, África 3, Ásia 7 e Oceania 2. As reservas continentais são usadas somente no próprio continente.
- Até 3 dados no ataque e 3 na defesa; comparação decrescente em pares; empate favorece a defesa; um exército permanece na origem.
- Ocupação configurável de 1 a 3 exércitos, limitada aos dados de ataque e às tropas disponíveis.
- Remanejamento entre vizinhos próprios. Tropas recebidas nessa fase não podem se mover novamente.
- Uma carta por turno com conquista; 42 cartas territoriais e 2 curingas. Trocas de símbolos iguais/diferentes, bônus territorial de 2 e progressão global 4/6/8/10/12/15/+5. Troca obrigatória com 5 ou mais cartas no início dos ataques. Eliminação transfere cartas.
- Verificação de vitória após cada ação, inclusive reforço e troca.

**Adaptação de preparação:** a distribuição inicial é automática e aleatória. Cada território recebe uma tropa e os jogadores completam 35/30/25/20 exércitos em mesas de 3/4/5/6 pessoas. Não há colocação inicial manual, diplomacia automatizada, modo de duplas ou regras opcionais de outras edições. O manual da aplicação é a referência desta implementação.

## Executar localmente

Requer Node.js 22 ou superior e npm.

```sh
npm ci
npm run dev
```

```sh
npm test                 # testes da lógica, inclusive partidas completas entre robôs
npm run build           # site estático em dist/, com caminhos relativos
npm run preview         # validação local do build
```

Fontes são empacotadas com a aplicação; o solo não consulta serviços externos durante a partida. Não há service worker: a primeira abertura exige carregar os arquivos do site.

## Publicar no GitHub Pages

1. No repositório, abra **Settings → Pages → Build and deployment → Source** e selecione **GitHub Actions**.
2. Na aba **Actions**, execute **Publicar no GitHub Pages** em `main`, ou envie um novo commit para `main`.
3. O workflow instala as dependências com o lockfile, roda os testes da lógica, gera `dist/` e publica o artefato. A URL de implantação aparece no job `deploy` e em **Settings → Pages**.

O workflow está em `.github/workflows/pages.yml`. Nenhuma chave de API é necessária para o modo padrão. Se o repositório for privado, a disponibilidade de Pages depende do plano do GitHub.

## Rede on-line e limites

O site é estático. O **PeerJS** usa `0.peerjs.com` (HTTPS/WebSocket, porta 443) para sinalização e **WebRTC DataChannel** para as mensagens. A configuração padrão de ICE da biblioteca utiliza STUN do Google e servidores públicos TURN do PeerJS. A disponibilidade desses serviços e a passagem por firewalls/NAT não são garantidas; para operação com SLA, configure infraestrutura própria.

O anfitrião é a autoridade: valida ações, lança dados e transmite a cada convidado uma visão sem as cartas e objetivos secretos dos demais. O objetivo do vencedor é revelado ao terminar. Não é um servidor antitrapaça: o anfitrião tem acesso técnico ao estado completo, portanto jogue com pessoas de confiança.

Mantenha a aba do anfitrião aberta. Não há migração de anfitrião, recuperação após seu fechamento, contas ou banco de dados. Uma desconexão da sinalização tenta reconectar automaticamente. Um convidado pode recarregar e reentrar na mesma sala com a mesma aba/navegador, preservando sua identidade de sessão. Jogadores desconectados mantêm seu turno; não há substituição automática. Não compartilhe a sessão do navegador; o convite dá acesso aos lugares ainda disponíveis da sala.

Para usar um PeerServer próprio, defina antes de compilar:

```sh
VITE_PEER_HOST=peer.seudominio.com
VITE_PEER_PORT=443
VITE_PEER_PATH=/
VITE_PEER_SECURE=true
# Opcional, JSON de RTCIceServer[]:
VITE_PEER_ICE_SERVERS='[{"urls":"stun:stun.seudominio.com:3478"}]'
```

Essas opções são públicas e ficam no JavaScript distribuído. **Não coloque segredos ou credenciais TURN permanentes no build.** Infraestrutura de produção com credenciais temporárias exige um serviço para emiti-las.

## Testes de navegador

```sh
npx playwright install chromium
npm run test:e2e
# Ou use Chromium já instalado:
CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e
```

O Playwright inicia um PeerServer local e uma instância Vite separada. O teste on-line usa conexões WebRTC reais entre dois contextos de navegador com ICE local, sem depender do broker público. Testa entrada por convite, sincronização de reforços, restrição de controles fora do turno e reconexão do convidado. Isso não substitui testes de conectividade entre redes externas.

**Limite do ambiente de desenvolvimento em nuvem:** o Chromium pré-instalado tem a política gerenciada `WebRtcIPHandling=disable_non_proxied_udp`. Nesse ambiente, a sinalização local foi estabelecida, mas não houve candidatos ICE e o teste WebRTC não completou a entrada do convidado. A restrição não foi removida nem o teste desativado. Execute o teste completo em um navegador/rede que permita WebRTC para confirmar o fluxo on-line. Os testes de interface solo e as simulações da lógica não dependem desse canal.

## Cartografia e identidade visual

O mapa utiliza dados Natural Earth 1:110m, distribuídos em domínio público pelo pacote `world-atlas`, em projeção Natural Earth. Uma partição geométrica por continente cria 42 regiões estratégicas com os mesmos IDs, cartas e conexões da versão anterior; campanhas salvas continuam compatíveis. Os contornos geográficos não alteram as regras de vizinhança.

`src/map-geometry.json` já está gerado e versionado: o navegador não baixa cartografia nem executa triangulação. Para editar as posições das regiões ou linhas-guia, altere `scripts/generate-map.js` e execute `npm run generate:map`. A geração é determinística e não é necessária para builds normais. Fontes Barlow Condensed, IBM Plex Mono e DM Sans são distribuídas com o site e suas licenças ficam em `public/licenses`.

## Estrutura

| Arquivo                   | Responsabilidade                                         |
| ------------------------- | -------------------------------------------------------- |
| `src/world.js`            | Mapa, continentes, fronteiras e cores                    |
| `src/engine.js`           | Regras puras, validação, bots e filtragem de informações |
| `src/network.js`          | Salas, identidade de sessão e sincronização PeerJS       |
| `src/main.js`             | Interface, comandos e persistência solo                  |
| `src/style.css`           | Layout responsivo e estilos                              |
| `src/tactical.css`        | Identidade militar moderna e legibilidade do mapa        |
| `src/tactical-map.js`     | Regiões geográficas, rotas, marcadores e coordenadas     |
| `scripts/generate-map.js` | Geração offline da cartografia                           |
| `tests/engine.test.js`    | Regras e simulações determinísticas                      |
| `tests/app.spec.js`       | Fluxos no navegador e comunicação WebRTC                 |

Não há backend próprio, telemetria ou envio da campanha solo. Para jogar on-line, os participantes se conectam aos serviços de sinalização/ICE e ao anfitrião.
