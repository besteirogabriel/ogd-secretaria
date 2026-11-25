# Secretaria do Templo Espírita Ogum Quebra Demanda

Aplicação local para recepção, agenda, fichas individuais, acompanhamento espiritual e contas a pagar e a receber. Requer Python 3.8+ com SQLite e scrypt. Não há dependências externas.

## Executar

```bash
git clone https://github.com/besteirogabriel/ogd-secretaria.git
cd ogd-secretaria
python3 iniciar.py
```

Acesse http://127.0.0.1:8765 e crie o primeiro administrador. Em **Equipe**, cadastre contas individuais de Atendimento, Financeiro ou Administração. Atendimento acessa agenda e fichas. Financeiro acessa lançamentos e nomes para vinculação. Administração também gerencia contas e consulta o histórico de operações.

## Atualizar uma instalação existente

Encerre o processo anterior, faça uma cópia de templo.sqlite3 e execute na pasta da instalação:

```bash
git pull --ff-only
python3 iniciar.py
```

A primeira inicialização copia os registros do banco anterior para dados/secretaria.sqlite3 em uma transação. O banco anterior permanece na pasta. Novas gravações, contas e sessões ficam em dados/, excluído do Git. Para backup, encerre o processo e copie essa pasta. Para recuperar a senha de uma conta pelo terminal local:

```bash
python3 iniciar.py --redefinir-senha seu@email.com
```

A aplicação escuta apenas na interface local. Cada sessão expira em oito horas. Para rodar sem abrir o navegador, use --sem-navegador.

## Instalar ou atualizar com geração de PDF

Na pasta do projeto (macOS/Linux):

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python iniciar.py
```

No Windows use .venv\Scripts\python.exe nos dois últimos comandos. O PDF A4 retrato é gerado pelo servidor após validação de sessão. Inclui identificação, signo, análise, posições espirituais e relatos vinculados. O arquivo de calendário ICS usa horário local e contém o título e o local do compromisso.

## Portal do aluno e autoagendamento

Na agenda, abra **Autoagendamento → Adicionar serviço**. Informe responsável, sala, dias da semana, início, fim, duração, antecedência e janela de reserva. Datas bloqueadas e serviços pausados deixam de oferecer vagas. Um participante pode criar conta em /agendar, confirmar um horário e consultar, remarcar ou cancelar suas reservas futuras. Conflitos de pessoa, responsável e sala são conferidos dentro da transação de reserva. A ficha espiritual e os relatos permanecem na secretaria.

### Disponibilizar o link fora do computador

O repositório contém a aplicação; o link de agendamento aponta para a instalação em execução. Para um servidor Linux com domínio próprio:

1. Instale a aplicação e as dependências conforme acima. Crie a primeira conta administrativa pela origem local antes de liberar o domínio.
2. Aponte o DNS do domínio para o servidor e disponibilize 80/443 para seu proxy HTTPS. Mantenha o processo Python em 127.0.0.1:8765.
3. Inicie o processo com a origem pública exata. Substitua o domínio de exemplo pelo domínio real:

```bash
OGD_PUBLIC_ORIGIN=https://agenda.seudominio.com.br .venv/bin/python iniciar.py --sem-navegador
```

4. Em Caddy no mesmo servidor, use este bloco substituindo o domínio:

```caddyfile
agenda.seudominio.com.br {
    reverse_proxy 127.0.0.1:8765
}
```

O proxy deve preservar o cabeçalho Host original. A criação do primeiro administrador pela origem pública é bloqueada. O cookie de sessão servido pelo domínio HTTPS recebe Secure. A agenda exibe o endereço configurado com /agendar. No modo local, o painel identifica o endereço como restrito ao computador.

## Operação da agenda

As visões Dia, Semana, Mês e Lista compartilham os filtros de responsável, sala, origem e situação. Em equipes externas à rede local, a agenda usa o horário de Brasília. Na grade, arrastar um compromisso abre a edição com a nova data e o novo horário. Confira e salve para efetivar a mudança.

No painel do compromisso, registre a chegada, abra a ficha, conclua o atendimento com um relato ou marque falta. A Recepção reúne quem aguarda, relatos em aberto e análises em rascunho. Use **Buscar pessoa** ou Ctrl+K (Cmd+K no Mac) para abrir uma ficha sem voltar à lista de cadastros.

Em **Agenda → Autoagendamento → Visualizar portal**, a equipe pode conferir datas e horários publicados. O participante acompanha seus horários, pode exportá-los ao calendário e recebe confirmação na tela ao reservar, remarcar ou cancelar.
