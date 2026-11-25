# syntax=docker/dockerfile:1
# Packs what the release workflow builds; the build context holds
#   bin/amd64/yanrr-image-proxy, bin/arm64/yanrr-image-proxy   the image proxy for each platform
FROM gcr.io/distroless/cc-debian13:nonroot
ARG TARGETARCH
WORKDIR /app
COPY --chmod=755 bin/${TARGETARCH}/yanrr-image-proxy yanrr-image-proxy
ENV YANRR_IMAGE_PROXY__LISTEN=0.0.0.0:3001
EXPOSE 3001
# The key comes from YANRR_IMAGE_PROXY__KEY or /app/config.toml
ENTRYPOINT ["/app/yanrr-image-proxy"]
