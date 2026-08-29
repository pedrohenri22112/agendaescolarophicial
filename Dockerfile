FROM node:18-bullseye-slim

WORKDIR /app

# dependências para compilar sqlite3 se necessário
RUN apt-get update && apt-get install -y build-essential python3 make gcc g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

# criar diretório para banco
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server.js"]
