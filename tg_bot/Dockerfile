# Use Node.js 22.21.1 Alpine as base image
FROM node:22.21.1-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package* ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Start the application
CMD ["node", "dist/index.js"]