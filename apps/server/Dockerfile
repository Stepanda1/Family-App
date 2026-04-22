FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN npm ci

COPY tsconfig.base.json ./
COPY apps/server apps/server
COPY packages/contracts packages/contracts

RUN npm run db:generate --workspace @family-app/server
RUN npm run build --workspace @family-app/server

EXPOSE 4000

CMD ["npm", "run", "start", "--workspace", "@family-app/server"]
