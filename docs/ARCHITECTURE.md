# Flex Node architecture

```text
                    Internet
                       |
                 Reverse Proxy
                       |
                +------+------+
                | Flex Panel |
                | Node/Fastify|
                +------+------+
                       |
                     MySQL
                       |
              server desired state
                       |
              +--------+--------+
              |                 |
        Worker Node 1     Worker Node 2
              |                 |
           Docker             Docker
          /  |  \            /  |  \
       SAMP CRMP ...       SAMP CRMP ...

```

## Почему это лучше

Панель не обязана сама держать Docker socket. Worker — отдельный доверенный агент.

Пользовательский браузер никогда не получает доступ к Docker API.

Каждый сервер получает:

- отдельный container;
- отдельный UDP port;
- отдельную директорию;
- RAM limit;
- CPU limit;
- PID limit;
- restart policy;
- heartbeat;
- метрики.

## Дальнейшее развитие

1. Несколько Worker Node.
2. Автоматический scheduler.
3. Выбор worker по свободной RAM/CPU.
4. Disk quota.
5. Network bandwidth quota.
6. WebSocket-консоль.
7. Backups.
8. Snapshots.
9. ZIP upload/extract.
10. Auto-update server files.
