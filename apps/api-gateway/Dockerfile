# =============================================================================
# Stage 1: Build (.NET 10 SDK)
# =============================================================================
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build

WORKDIR /src

# Cache de restore
COPY ApiGateway.csproj .
RUN dotnet restore

# Source
COPY . .
RUN dotnet publish ApiGateway.csproj \
    --configuration Release \
    --no-restore \
    --output /app \
    /p:UseAppHost=false

# =============================================================================
# Stage 2: Runtime
# =============================================================================
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime

# curl para HEALTHCHECK (a imagem aspnet slim não vem com ele).
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Usuário não-root (aspnet:10.0 já pode trazer o grupo app pré-criado)
RUN (getent group app >/dev/null || groupadd -r app) && \
    (getent passwd app >/dev/null || useradd -r -g app app)

COPY --from=build /app .
RUN chown -R app:app /app

USER app

EXPOSE 5000
ENV ASPNETCORE_URLS=http://+:5000
ENV ASPNETCORE_ENVIRONMENT=Production

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl --fail http://localhost:5000/health || exit 1

ENTRYPOINT ["dotnet", "ApiGateway.dll"]
