# syntax=docker/dockerfile:1
# Packs what the release workflow builds; the build context holds
#   bin/amd64/yanrr, bin/arm64/yanrr   the server for each platform
#   web/                               the web client build
FROM gcr.io/distroless/cc-debian13:nonroot
ARG TARGETARCH
WORKDIR /app
COPY --chmod=755 bin/${TARGETARCH}/yanrr yanrr
COPY web web
# /data holds the search index, so it must be the server's own; the image has no shell to make it, so the empty
# home directory of its nonroot user is copied there.
COPY --from=gcr.io/distroless/cc-debian13:nonroot --chown=65532:65532 /home/nonroot /data
ENV YANRR_SERVER__LISTEN=0.0.0.0:3000 \
    YANRR_SERVER__WEB_DIR=web \
    YANRR_SEARCH__DIR=/data/search
EXPOSE 3000
# The rest of the config comes from YANRR_* variables or /app/config.toml
ENTRYPOINT ["/app/yanrr"]
