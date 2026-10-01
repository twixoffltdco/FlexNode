# Flex Node

Реальный Node.js-проект хостинга SAMP/CRMP.

## Архитектура

- Node.js 22 + TypeScript
- Fastify API
- MySQL + Prisma
- Docker Engine для 24/7 процессов игровых серверов
- Cookie содержит только сессионный JWT. Сам сервер, файлы и настройки хранятся в MySQL/диске.
- Docker container получает `restart=unless-stopped`, поэтому сервер продолжает работать после закрытия браузера.
- Панель: `/panel.html`
- Файловый менеджер: `/files.html?id=SERVER_ID`

## Запуск

1. Установить Docker + Docker Compose.
2. Скопировать `.env.example` в `.env`.
3. Задать настоящий `JWT_SECRET`.
4. Выполнить `docker compose up -d --build`.
5. Открыть `http://SERVER_IP:3000`.

## Важно про production

Docker socket даёт приложению высокие права. Для публичного коммерческого хостинга лучше вынести worker/agent управления контейнерами в отдельный privileged-сервис, добавить лимиты CPU/RAM/disk, reverse proxy, TLS, rate limits, quotas, antivirus/file scanning и аудит действий.

## IP

Постоянный игровой адрес — это IP/домен ноды + выделенный порт. Если провайдер действительно выдаёт новый внешний IP каждые 24 часа, это нельзя исправить кодом панели: нужен статический IP, DNS, reverse proxy или отдельная сеть/балансировщик. Не следует обещать пользователю «вечный IP» без соответствующей инфраструктуры.

## Публичный каталог

Каталог публичных SAMP/CRMP серверов можно добавить отдельным crawler-модулем: он собирает только общедоступные сведения (IP, порт, название, online/slots) и обновляет их по расписанию. Управление чужими серверами без разрешения в Flex Node не предусматривается.


## Production split

- `src/server.ts` — control-plane API/panel.
- `worker/` — privileged game runtime worker.
- `docker-compose.production.yml` — deployment for a real game Worker Node.
- `PRODUCTION.md` — deployment requirements and limits.

The game Worker must run on infrastructure that supports long-running Docker containers and public UDP ports. A free serverless runtime with 256 MB RAM is not a suitable game Worker.
