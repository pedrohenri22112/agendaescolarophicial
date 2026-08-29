# Agenda Escolar - protótipo

Protótipo da Agenda Escolar com frontend estático (public/) e backend Node.js + SQLite (server.js).

Como rodar localmente (sem Docker):

1. Instale dependências
   npm install

2. Inicie o servidor
   node server.js

O servidor cria um banco SQLite em ./data/db.sqlite na primeira execução e popula dados de exemplo.

Contas de teste:
- pedro / 1234 (aluno 8B)
- maria / prof123 (professor 8B)
- admin / admin (admin)

Frontend está em /public e é servido automaticamente pelo servidor quando executado.

Deploy (Docker):
- docker-compose up --build

A aplicação pública (frontend) também foi publicada no GitHub Pages (branch gh-pages).