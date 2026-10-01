# Flex Node Worker

Worker Node управляет реальными Docker-контейнерами игровых серверов.

## Лимиты

Для каждого сервера задаются:

- `memoryMb` — RAM;
- `cpuCores` — доля CPU;
- `PidsLimit` — максимум процессов;
- ограничение CPU через NanoCPUs/Quota;
- Docker restart policy;
- отдельный UDP-порт;
- отдельная директория файлов.

Worker периодически сверяет состояние БД с Docker и автоматически восстанавливает контейнер, если сервер должен быть RUNNING.

В production Docker socket лучше не давать основной панели. Worker должен быть отдельным privileged-компонентом.
