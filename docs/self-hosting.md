# Self-hosting YANRR

YANRR is one server (with the web app built in) plus PostgreSQL. The desktop and Android apps connect to that server.

## Requirements

- A Linux server (amd64 or arm64) with Docker and its Compose plugin (`docker compose`, not `docker-compose`).
- A domain whose DNS A/AAAA record points at the server, with ports 80 and 443 open. The bundled Caddy uses them to get an HTTPS certificate.

## Install

1. Make a directory and download `compose.yaml` and `example.env` from the [latest release](https://github.com/Bliod-Cook/YANRR/releases/latest), then rename `example.env` to `.env`:

   ```sh
   mkdir yanrr && cd yanrr
   curl -fLO https://github.com/Bliod-Cook/YANRR/releases/latest/download/compose.yaml
   curl -fLO https://github.com/Bliod-Cook/YANRR/releases/latest/download/example.env
   mv example.env .env
   ```

2. In `.env`, set `YANRR_SERVER__PUBLIC_URL` to your address, e.g. `https://rss.example.com`, and `YANRR_AUTH__SECRET` to the output of `openssl rand -hex 32`.

3. Start the services:

   ```sh
   docker compose up -d
   ```

   Open your address and sign up. The first visit can take a few seconds while Caddy gets the certificate.

4. Once everyone who needs an account has one, set `YANRR_AUTH__REGISTRATION=false` in `.env` and run `docker compose up -d` again. Do this early: anyone with an account can make the server fetch any URL, including ones on your private network.

There is no password reset, so keep your password somewhere safe.

## Connect the apps

- **Web**: open your address in a browser.
- **Desktop and Android**: download them from the same release page. macOS: `.dmg` (`arm64` for Apple silicon); Windows: `.exe`; Linux: `.AppImage` or `.deb`; Android: `.apk`.
  - On first launch, enter your address as the server address, exactly as in `YANRR_SERVER__PUBLIC_URL`.
  - The macOS app isn't notarized. If macOS refuses to open it, run `xattr -dr com.apple.quarantine /Applications/Yanrr.app`.
  - To switch servers, sign out and use **Change** on the sign-in screen. This clears the app's local data, not the server's.

## Use your own reverse proxy

Remove the `COMPOSE_PROFILES=caddy` line from `.env` before the first start. YANRR is then reachable only at `127.0.0.1:3000` on the host. Point your proxy there and keep in mind:

- Serve YANRR at the root of its domain, not under a path.
- `YANRR_SERVER__PUBLIC_URL` must be the address users open, including `https://`.
- Pass `X-Forwarded-For`. Sign-in rate limits are per client IP, and without it every client shares one limit.

Caddy:

```caddy
rss.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

nginx (inside your existing `server` block for the domain, with TLS set up):

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

If the proxy runs in Docker, attach it to YANRR's Compose network and proxy to `yanrr:3000`.

**Home network without HTTPS**: set `YANRR_SERVER__PUBLIC_URL=http://<server IP>:3000`, remove `COMPOSE_PROFILES`, and change the port in `compose.yaml` to `"3000:3000"`. The web, desktop and Android apps all work this way.

## Configuration

Any key in [`config.example.toml`](../server/config.example.toml) can go in `.env` as `YANRR_<SECTION>__<KEY>`. For example, `url` under `[rsshub]` becomes `YANRR_RSSHUB__URL`. Run `docker compose up -d` to apply changes.

| Variable | Default | Purpose |
| --- | --- | --- |
| `YANRR_SERVER__PUBLIC_URL` | | The address users open |
| `YANRR_AUTH__SECRET` | | Signs sessions; changing it signs everyone out |
| `YANRR_AUTH__REGISTRATION` | `true` | Whether new accounts can sign up |
| `YANRR_RSSHUB__URL` | `https://rsshub.app` | RSSHub instance for `rsshub://` feeds and route discovery |
| `YANRR_ICONS__PROVIDER` | `google` | Where icons of sites without a feed image come from: `google`, `google-cn` (reachable from mainland China) or `direct` (the sites themselves) |
| `RUST_LOG` | `info` | Log level, e.g. `debug` |
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | | HTTP proxy for outgoing requests |
| `SSL_CERT_FILE` | | A PEM file of certificate authorities to trust besides the public ones, e.g. the private CA of your RSSHub or model (mount it into the container). Without Docker, adding the CA to the system's trusted certificates works too. |

### Your own RSSHub

The public `rsshub.app` is rate limited. To run your own, add this under `services:` in `compose.yaml`:

```yaml
  rsshub:
    image: diygod/rsshub
    restart: unless-stopped
```

Then set `YANRR_RSSHUB__URL=http://rsshub:1200` in `.env` and run `docker compose up -d`. Existing `rsshub://` feeds move to the new instance automatically.

## Upgrade

Back up first (see below), then:

```sh
docker compose pull
docker compose up -d
```

Database migrations run on start. To stay on one release line, change the image tag in `compose.yaml` from `latest` to, e.g., `0.1`. Don't raise the `postgres` major version in place; that needs a dump and restore.

The first start with article search builds the search index in the background, which takes a few minutes per 100,000 articles; until it is done, search finds only the articles indexed so far, newest first. The index lives in the `data` volume; if the `yanrr` service in your `compose.yaml` has no `data:/data` volume, download `compose.yaml` again, or the index is rebuilt whenever the container is recreated.

## Back up and restore

Everything lives in PostgreSQL; the search index is built from it, so it needs no backup. Keep `.env` too.

```sh
docker compose exec -T postgres pg_dump -U yanrr yanrr > yanrr.sql
```

To restore on a fresh install, load the dump before YANRR starts for the first time:

```sh
docker compose up -d --wait postgres
docker compose exec -T postgres psql -U yanrr yanrr < yanrr.sql
docker compose up -d
```

## Without Docker

You need PostgreSQL 13 or newer and a reverse proxy for HTTPS (see above).

1. Create the database:

   ```sh
   sudo -u postgres createuser -P yanrr
   sudo -u postgres createdb -O yanrr yanrr
   ```

2. Download `yanrr-server-<version>-linux-<arch>.tar.gz` from the release and unpack it to `/opt/yanrr`:

   ```sh
   tar -xzf yanrr-server-<version>-linux-<arch>.tar.gz
   sudo mv yanrr-server-<version>-linux-<arch> /opt/yanrr
   sudo cp /opt/yanrr/config.example.toml /opt/yanrr/config.toml
   ```

   In `config.toml`, set `listen = "127.0.0.1:3000"`, `public_url`, `secret` and the password in `database.url`, and uncomment `web_dir = "web"`.

3. Run it as a service. Create a user for it:

   ```sh
   sudo useradd --system --no-create-home yanrr
   sudo chown -R yanrr: /opt/yanrr && sudo chmod 600 /opt/yanrr/config.toml
   ```

   Save this as `/etc/systemd/system/yanrr.service`, then run `sudo systemctl enable --now yanrr`:

   ```ini
   [Unit]
   After=network-online.target postgresql.service
   Wants=network-online.target

   [Service]
   User=yanrr
   WorkingDirectory=/opt/yanrr
   ExecStart=/opt/yanrr/yanrr
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```

To upgrade, replace `yanrr` and `web/` with the ones from the new release and run `sudo systemctl restart yanrr`.

## Troubleshooting

Logs: `docker compose logs yanrr` (or `caddy`).

| Symptom | Fix |
| --- | --- |
| `yanrr` keeps restarting; the log says *Secret key cannot be empty* or *must be at least 32 characters* | Set `YANRR_AUTH__SECRET` (see Install). |
| Signing in fails with *Invalid origin* | You opened a different address than `YANRR_SERVER__PUBLIC_URL`. Scheme, host and port must all match. |
| Signing in seems to work, but you're signed out right away | One side uses `https://` and the other `http://`. |
| The Android app says *No server answers at this address* | Check the address, including `http://` or `https://`, and that the phone can reach it. |
| Caddy can't get a certificate | Check that the domain's DNS points at this server and that ports 80 and 443 are open. |
| *This RSSHub instance is unavailable currently*, or `rsshub://` feeds stop updating | The public instance is rate limited; [run your own](#your-own-rsshub). |
| Sign-up fails | Registration is off (`YANRR_AUTH__REGISTRATION=false`). |
