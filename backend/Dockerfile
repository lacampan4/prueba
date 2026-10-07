# Imagen de Node.js para el backend de SAP en Render
FROM node:22-alpine

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
# Límite de heap configurable (MB). En Render de 512 MB, 384 deja margen para buffers.
ENV NODE_HEAP_MB=384
CMD ["sh", "-c", "node --max-old-space-size=${NODE_HEAP_MB} app.js"]
