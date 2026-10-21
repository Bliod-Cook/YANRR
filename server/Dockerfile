# syntax=docker/dockerfile:1
# Packs what the release workflow builds; the build context holds
#   bin/amd64/yannr, bin/arm64/yannr   the server for each platform
#   web/                               the web client build
FROM gcr.io/distroless/cc-debian13:nonroot
ARG TARGETARCH
WORKDIR /app
COPY --chmod=755 bin/${TARGETARCH}/yannr yannr
COPY web web
EXPOSE 3000
# Reads /app/config.toml
ENTRYPOINT ["/app/yannr"]
