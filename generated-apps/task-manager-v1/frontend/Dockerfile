FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Ensure lowercase component names exist on Linux (case-sensitive fs)
RUN cp components/ui/Button.tsx components/ui/button.tsx 2>/dev/null || true && \
    cp components/ui/Card.tsx   components/ui/card.tsx   2>/dev/null || true && \
    cp components/ui/Input.tsx  components/ui/input.tsx  2>/dev/null || true
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NODE_ENV=production
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
