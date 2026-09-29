/**
 * Launch marketplace catalog (~15 apps). Each app is an image (baked with Packer from
 * marketplace/<slug>/ — to come) plus this cloud-init, rendered with the variables.
 * `{{ var }}` placeholders are filled by MarketplaceService.renderCloudInit.
 */
export interface SeedApp {
  slug: string;
  name: string;
  category: 'cms' | 'ecommerce' | 'devtools' | 'frameworks' | 'automation' | 'collaboration' | 'business' | 'networking' | 'analytics' | 'ai';
  summary: string;
  description: string;
  version: string;
  minSizeId: string;
  ports: number[];
  variables: Array<{ name: string; label: string; type: 'string' | 'email' | 'password' | 'number' | 'boolean'; required?: boolean; default?: string; generate?: 'password' }>;
  cloudInit: string;
}

const adminEmail = { name: 'admin_email', label: 'Admin email', type: 'email' as const, required: true };
const adminPassword = { name: 'admin_password', label: 'Admin password', type: 'password' as const, generate: 'password' as const };
const domain = { name: 'domain', label: 'Domain (optional)', type: 'string' as const };

const dockerCompose = (name: string, compose: string, extra = '') => `#cloud-config
package_update: true
packages: [docker.io, docker-compose-v2, ufw]
write_files:
  - path: /opt/${name}/docker-compose.yml
    content: |
${compose.split('\n').map((l) => '      ' + l).join('\n')}
runcmd:
  - systemctl enable --now docker
  - cd /opt/${name} && docker compose up -d
${extra}
  - echo "prgd app ${name} ready" > /etc/motd
`;

export const MARKETPLACE_APPS: SeedApp[] = [
  {
    slug: 'wordpress', name: 'WordPress', category: 'cms', version: '6.6', minSizeId: 's-1vcpu-2gb', ports: [80, 443],
    summary: 'The world\'s most popular CMS, with MariaDB and automatic HTTPS.',
    description: 'WordPress with MariaDB and Caddy for automatic TLS. Log in at /wp-admin with the admin credentials you set.',
    variables: [adminEmail, adminPassword, domain],
    cloudInit: dockerCompose('wordpress', `services:
  db:
    image: mariadb:11
    environment: { MARIADB_ROOT_PASSWORD: "{{ admin_password }}", MARIADB_DATABASE: wp, MARIADB_USER: wp, MARIADB_PASSWORD: "{{ admin_password }}" }
    volumes: [db:/var/lib/mysql]
  wordpress:
    image: wordpress:6.6
    environment: { WORDPRESS_DB_HOST: db, WORDPRESS_DB_USER: wp, WORDPRESS_DB_PASSWORD: "{{ admin_password }}", WORDPRESS_DB_NAME: wp }
    volumes: [wp:/var/www/html]
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    command: caddy reverse-proxy --from "{{ domain }}" --to wordpress:80
volumes: { db: {}, wp: {} }`),
  },
  {
    slug: 'woocommerce', name: 'WooCommerce', category: 'ecommerce', version: '9.x', minSizeId: 's-2vcpu-4gb', ports: [80, 443],
    summary: 'WordPress + WooCommerce, ready for a Saudi or international store.',
    description: 'WordPress with the WooCommerce plugin preinstalled and Moyasar and other gateway plugins available.',
    variables: [adminEmail, adminPassword, domain],
    cloudInit: dockerCompose('woocommerce', `services:
  db:
    image: mariadb:11
    environment: { MARIADB_ROOT_PASSWORD: "{{ admin_password }}", MARIADB_DATABASE: wp, MARIADB_USER: wp, MARIADB_PASSWORD: "{{ admin_password }}" }
    volumes: [db:/var/lib/mysql]
  wordpress:
    image: wordpress:6.6
    environment: { WORDPRESS_DB_HOST: db, WORDPRESS_DB_USER: wp, WORDPRESS_DB_PASSWORD: "{{ admin_password }}", WORDPRESS_DB_NAME: wp }
    volumes: [wp:/var/www/html]
    ports: ["80:80"]
volumes: { db: {}, wp: {} }`, '  - sleep 20 && docker compose -f /opt/woocommerce/docker-compose.yml exec -T wordpress bash -c "curl -fsSL https://downloads.wordpress.org/plugin/woocommerce.latest-stable.zip -o /tmp/wc.zip && apt-get update -qq && apt-get install -y -qq unzip && unzip -qo /tmp/wc.zip -d /var/www/html/wp-content/plugins"'),
  },
  {
    slug: 'docker', name: 'Docker', category: 'devtools', version: '27', minSizeId: 's-1vcpu-1gb', ports: [22],
    summary: 'Ubuntu with Docker Engine and Docker Compose preinstalled.',
    description: 'A clean Ubuntu 24.04 server with the latest Docker Engine, Compose v2 and Buildx, and the default user in the docker group.',
    variables: [],
    cloudInit: `#cloud-config
package_update: true
packages: [docker.io, docker-compose-v2, docker-buildx]
runcmd:
  - systemctl enable --now docker
  - usermod -aG docker ubuntu || true
`,
  },
  {
    slug: 'nodejs', name: 'Node.js', category: 'frameworks', version: '22 LTS', minSizeId: 's-1vcpu-1gb', ports: [22, 80, 443, 3000],
    summary: 'Node.js 22 LTS with pnpm, pm2 and Caddy.',
    description: 'Node 22 (via NodeSource), pnpm and pm2 for process management, Caddy as reverse proxy on :80/:443 to :3000.',
    variables: [domain],
    cloudInit: `#cloud-config
package_update: true
packages: [ca-certificates, curl, gnupg, debian-keyring, debian-archive-keyring, apt-transport-https]
runcmd:
  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  - apt-get install -y nodejs
  - npm i -g pnpm pm2
  - curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  - curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  - apt-get update && apt-get install -y caddy
  - printf '{{ domain }}:80 {\\n  reverse_proxy localhost:3000\\n}\\n' > /etc/caddy/Caddyfile
  - systemctl restart caddy
`,
  },
  {
    slug: 'laravel', name: 'Laravel', category: 'frameworks', version: '11', minSizeId: 's-1vcpu-2gb', ports: [80, 443],
    summary: 'PHP 8.3, Composer, Nginx, MariaDB and a fresh Laravel 11 app.',
    description: 'LEMP stack tuned for Laravel with a new project at /var/www/app served by Nginx + PHP-FPM.',
    variables: [adminPassword, domain],
    cloudInit: `#cloud-config
package_update: true
packages: [nginx, mariadb-server, php8.3-fpm, php8.3-mysql, php8.3-xml, php8.3-mbstring, php8.3-curl, php8.3-zip, php8.3-bcmath, unzip, git]
runcmd:
  - curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer
  - mysql -e "CREATE DATABASE app; CREATE USER 'app'@'localhost' IDENTIFIED BY '{{ admin_password }}'; GRANT ALL ON app.* TO 'app'@'localhost';"
  - cd /var/www && composer create-project laravel/laravel app --no-interaction && chown -R www-data:www-data app
  - sed -i 's#root /var/www/html;#root /var/www/app/public;#; s#index index.html#index index.php index.html#' /etc/nginx/sites-available/default
  - sed -i 's#\\#location ~ \\\\.php\\$ {#location ~ \\\\.php$ { include snippets/fastcgi-php.conf; fastcgi_pass unix:/run/php/php8.3-fpm.sock; }\\n#' /etc/nginx/sites-available/default
  - systemctl restart nginx php8.3-fpm
`,
  },
  {
    slug: 'django', name: 'Django', category: 'frameworks', version: '5', minSizeId: 's-1vcpu-2gb', ports: [80, 443],
    summary: 'Python 3.12, Django 5, Gunicorn, PostgreSQL and Nginx.',
    description: 'A production-shaped Django deployment: Gunicorn behind Nginx, PostgreSQL 16, project at /srv/app.',
    variables: [adminPassword, domain],
    cloudInit: `#cloud-config
package_update: true
packages: [python3-venv, python3-pip, postgresql, nginx]
runcmd:
  - sudo -u postgres psql -c "CREATE USER app WITH PASSWORD '{{ admin_password }}';" -c "CREATE DATABASE app OWNER app;"
  - mkdir -p /srv/app && cd /srv/app && python3 -m venv venv && ./venv/bin/pip install django gunicorn psycopg[binary] && ./venv/bin/django-admin startproject app .
  - printf '[Unit]\\nDescription=gunicorn\\n[Service]\\nWorkingDirectory=/srv/app\\nExecStart=/srv/app/venv/bin/gunicorn app.wsgi -b 127.0.0.1:8000\\n[Install]\\nWantedBy=multi-user.target\\n' > /etc/systemd/system/app.service
  - systemctl enable --now app
  - printf 'server { listen 80; server_name {{ domain }} _; location / { proxy_pass http://127.0.0.1:8000; proxy_set_header Host $host; } }\\n' > /etc/nginx/sites-available/default
  - systemctl restart nginx
`,
  },
  {
    slug: 'n8n', name: 'n8n', category: 'automation', version: '1.x', minSizeId: 's-1vcpu-2gb', ports: [80, 443],
    summary: 'Workflow automation with 400+ integrations and AI nodes.',
    description: 'n8n with PostgreSQL storage and Caddy for HTTPS. Includes the AI agent nodes; point them at the prgd inference gateway or your own keys.',
    variables: [adminEmail, adminPassword, domain],
    cloudInit: dockerCompose('n8n', `services:
  db:
    image: postgres:16
    environment: { POSTGRES_USER: n8n, POSTGRES_PASSWORD: "{{ admin_password }}", POSTGRES_DB: n8n }
    volumes: [db:/var/lib/postgresql/data]
  n8n:
    image: n8nio/n8n:latest
    environment: { DB_TYPE: postgresdb, DB_POSTGRESDB_HOST: db, DB_POSTGRESDB_USER: n8n, DB_POSTGRESDB_PASSWORD: "{{ admin_password }}", N8N_HOST: "{{ domain }}", WEBHOOK_URL: "https://{{ domain }}/" }
    volumes: [n8n:/home/node/.n8n]
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    command: caddy reverse-proxy --from "{{ domain }}" --to n8n:5678
volumes: { db: {}, n8n: {} }`),
  },
  {
    slug: 'nextcloud', name: 'Nextcloud', category: 'collaboration', version: '30', minSizeId: 's-2vcpu-4gb', ports: [80, 443],
    summary: 'Self-hosted files, calendar and office on your own server.',
    description: 'Nextcloud Hub with MariaDB and Redis. Your files live on your own server, not on a third party service.',
    variables: [adminPassword, domain],
    cloudInit: dockerCompose('nextcloud', `services:
  db:
    image: mariadb:11
    command: --transaction-isolation=READ-COMMITTED --binlog-format=ROW
    environment: { MARIADB_ROOT_PASSWORD: "{{ admin_password }}", MARIADB_DATABASE: nextcloud, MARIADB_USER: nextcloud, MARIADB_PASSWORD: "{{ admin_password }}" }
    volumes: [db:/var/lib/mysql]
  redis:
    image: redis:7-alpine
  app:
    image: nextcloud:30
    ports: ["80:80"]
    environment: { MYSQL_HOST: db, MYSQL_DATABASE: nextcloud, MYSQL_USER: nextcloud, MYSQL_PASSWORD: "{{ admin_password }}", REDIS_HOST: redis, NEXTCLOUD_ADMIN_USER: admin, NEXTCLOUD_ADMIN_PASSWORD: "{{ admin_password }}", NEXTCLOUD_TRUSTED_DOMAINS: "{{ domain }}" }
    volumes: [nc:/var/www/html]
volumes: { db: {}, nc: {} }`),
  },
  {
    slug: 'mattermost', name: 'Mattermost', category: 'collaboration', version: '10', minSizeId: 's-2vcpu-4gb', ports: [80, 443],
    summary: 'Self-hosted team messaging (Slack alternative).',
    description: 'Mattermost Team Edition with PostgreSQL.',
    variables: [adminPassword, domain],
    cloudInit: dockerCompose('mattermost', `services:
  db:
    image: postgres:16
    environment: { POSTGRES_USER: mm, POSTGRES_PASSWORD: "{{ admin_password }}", POSTGRES_DB: mattermost }
    volumes: [db:/var/lib/postgresql/data]
  app:
    image: mattermost/mattermost-team-edition:10
    ports: ["80:8065"]
    environment: { MM_SQLSETTINGS_DRIVERNAME: postgres, MM_SQLSETTINGS_DATASOURCE: "postgres://mm:{{ admin_password }}@db:5432/mattermost?sslmode=disable", MM_SERVICESETTINGS_SITEURL: "https://{{ domain }}" }
    volumes: [mm:/mattermost/data]
volumes: { db: {}, mm: {} }`),
  },
  {
    slug: 'odoo', name: 'Odoo', category: 'business', version: '18', minSizeId: 's-2vcpu-4gb', ports: [80, 443, 8069],
    summary: 'ERP, CRM, invoicing and inventory — popular with Saudi SMEs.',
    description: 'Odoo 18 Community with PostgreSQL. Saudi localisation (l10n_sa) installable from Apps.',
    variables: [adminPassword],
    cloudInit: dockerCompose('odoo', `services:
  db:
    image: postgres:16
    environment: { POSTGRES_USER: odoo, POSTGRES_PASSWORD: "{{ admin_password }}", POSTGRES_DB: postgres }
    volumes: [db:/var/lib/postgresql/data]
  odoo:
    image: odoo:18
    ports: ["80:8069"]
    environment: { HOST: db, USER: odoo, PASSWORD: "{{ admin_password }}" }
    volumes: [odoo:/var/lib/odoo]
volumes: { db: {}, odoo: {} }`),
  },
  {
    slug: 'wireguard', name: 'WireGuard VPN', category: 'networking', version: '1.0', minSizeId: 's-1vcpu-1gb', ports: [51820],
    summary: 'Personal or team VPN with a web UI (wg-easy).',
    description: 'WireGuard with the wg-easy admin panel on :51821 (restrict it with a firewall).',
    variables: [adminPassword],
    cloudInit: dockerCompose('wireguard', `services:
  wg:
    image: ghcr.io/wg-easy/wg-easy:14
    ports: ["51820:51820/udp", "51821:51821/tcp"]
    environment: { PASSWORD_HASH: "", WG_HOST: "auto" }
    cap_add: [NET_ADMIN, SYS_MODULE]
    sysctls: { net.ipv4.ip_forward: 1, net.ipv4.conf.all.src_valid_mark: 1 }
    volumes: [wg:/etc/wireguard]
volumes: { wg: {} }`),
  },
  {
    slug: 'plausible', name: 'Plausible Analytics', category: 'analytics', version: '2.1', minSizeId: 's-2vcpu-4gb', ports: [80, 443],
    summary: 'Privacy-friendly, cookie-free web analytics.',
    description: 'Plausible Community Edition with PostgreSQL and ClickHouse.',
    variables: [adminEmail, adminPassword, domain],
    cloudInit: dockerCompose('plausible', `services:
  db:
    image: postgres:16-alpine
    environment: { POSTGRES_PASSWORD: "{{ admin_password }}" }
    volumes: [db:/var/lib/postgresql/data]
  events_db:
    image: clickhouse/clickhouse-server:24-alpine
    volumes: [ch:/var/lib/clickhouse]
  plausible:
    image: ghcr.io/plausible/community-edition:v2.1
    command: sh -c "/entrypoint.sh db createdb && /entrypoint.sh db migrate && /entrypoint.sh run"
    ports: ["80:8000"]
    environment: { BASE_URL: "https://{{ domain }}", SECRET_KEY_BASE: "{{ admin_password }}{{ admin_password }}{{ admin_password }}", DATABASE_URL: "postgres://postgres:{{ admin_password }}@db:5432/plausible_db", CLICKHOUSE_DATABASE_URL: "http://events_db:8123/plausible_events_db" }
volumes: { db: {}, ch: {} }`),
  },
  {
    slug: 'ghost', name: 'Ghost', category: 'cms', version: '5', minSizeId: 's-1vcpu-2gb', ports: [80, 443],
    summary: 'Publishing platform for newsletters and blogs.',
    description: 'Ghost 5 with MySQL 8.',
    variables: [adminPassword, domain],
    cloudInit: dockerCompose('ghost', `services:
  db:
    image: mysql:8
    environment: { MYSQL_ROOT_PASSWORD: "{{ admin_password }}", MYSQL_DATABASE: ghost }
    volumes: [db:/var/lib/mysql]
  ghost:
    image: ghost:5
    ports: ["80:2368"]
    environment: { url: "https://{{ domain }}", database__client: mysql, database__connection__host: db, database__connection__user: root, database__connection__password: "{{ admin_password }}", database__connection__database: ghost }
    volumes: [ghost:/var/lib/ghost/content]
volumes: { db: {}, ghost: {} }`),
  },
  {
    slug: 'coolify', name: 'Coolify', category: 'devtools', version: '4', minSizeId: 's-2vcpu-4gb', ports: [22, 80, 443, 8000],
    summary: 'Self-hosted Heroku/Vercel alternative — deploy from Git.',
    description: 'Coolify v4 via the official installer. Open :8000 to finish setup.',
    variables: [],
    cloudInit: `#cloud-config
package_update: true
packages: [curl]
runcmd:
  - curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
`,
  },
  {
    slug: 'ai-starter', name: 'AI Starter (Ollama + Open WebUI)', category: 'ai', version: '2025.09', minSizeId: 's-4vcpu-8gb', ports: [80, 443],
    summary: 'Run open LLMs on CPU with a ChatGPT-style UI. GPU sizes in phase 3.',
    description: 'Ollama serving a small model (llama3.2:3b by default) and Open WebUI in front. Swap models with `ollama pull`.',
    variables: [adminEmail, adminPassword, { name: 'model', label: 'Model to preload', type: 'string', default: 'llama3.2:3b' }],
    cloudInit: dockerCompose('ai-starter', `services:
  ollama:
    image: ollama/ollama:latest
    volumes: [ollama:/root/.ollama]
  webui:
    image: ghcr.io/open-webui/open-webui:main
    ports: ["80:8080"]
    environment: { OLLAMA_BASE_URL: "http://ollama:11434", WEBUI_AUTH: "true" }
    volumes: [webui:/app/backend/data]
volumes: { ollama: {}, webui: {} }`, '  - sleep 15 && docker compose -f /opt/ai-starter/docker-compose.yml exec -T ollama ollama pull "{{ model }}"'),
  },
];
