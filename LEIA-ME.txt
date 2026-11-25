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
