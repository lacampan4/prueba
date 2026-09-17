# Imagen de Node.js para el backend de SAP en Render
FROM node:20-alpine

WORKDIR /app

# Copiar los archivos de configuración de npm
COPY package*.json ./

# Instalar las dependencias de producción
RUN npm install --production

# Copiar el código fuente del backend
COPY . .

# Puerto utilizado por el servicio (Render proporciona PORT)
EXPOSE 3000

# Comando para iniciar el servidor
CMD ["node", "app.js"]
