# ==========================================
# Stage 1: Build Svelte 5 + Tailwind v4 SPA
# ==========================================
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Build Static Go Binary (No CGO)
# ==========================================
FROM golang:1.27-alpine AS backend-builder
WORKDIR /app

COPY go.mod ./
COPY main.go ./
COPY internal ./internal
COPY migrations ./migrations
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Resolve dependencies & compile static binary with debug symbols stripped
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /homie .

# ==========================================
# Stage 3: Distroless Static Runtime (<20MB)
# ==========================================
FROM gcr.io/distroless/static-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=backend-builder /homie /homie

USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/homie"]
