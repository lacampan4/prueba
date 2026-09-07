# Dockerfile para el backend SAP (sin base de datos) en Render
FROM node:18-alpine

WORKDIR /app

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar dependencias
RUN npm install --production

# Copiar código fuente
COPY . .

# Puerto por defecto (Render proporciona PORT en env)
EXPOSE 3000

# Start command
CMD ["node", "app.js"]
