FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy server code
COPY . .

# Expose port
EXPOSE 5173

# Start server
CMD ["npm", "start"]
