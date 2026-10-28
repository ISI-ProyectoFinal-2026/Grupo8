# Guía de migraciones (Alembic)

Pasos para crear, probar e integrar una migración sin que Alembic quede con más de un head. Aplica a todas las migraciones del Sprint 4.

## Cómo funciona la cadena

Cada migración apunta a la anterior con `down_revision`. El "head" es la última de la cadena y tiene que haber uno solo.

Para ver el estado actual (desde `backend/`):

```bash
pipenv run alembic heads      # tiene que mostrar una sola línea
pipenv run alembic history    # muestra la cadena completa
```

Si dos migraciones tienen el mismo `down_revision`, aparecen dos heads y `alembic upgrade head` falla con "Multiple head revisions".

## Estado de la cadena

| Migración | Revisión | Apunta a (`down_revision`) |
|---|---|---|
| initial_schema | `f30ae74360fe` | — |
| corregir_tabla_conflictos | `7224388d1b53` | `f30ae74360fe` |
| normalizar_reserva | `a3c91e5d7b42` | `7224388d1b53` |
| reserva_personas (Issue 14.1) | `b7d4e2a91c58` | `a3c91e5d7b42` |
| descuentos (Issue 14.2) | `c1e8f5a37d92` | `b7d4e2a91c58` |
| ingreso_manual_efectivo (Issue 16.1) | `c3f81a5d9e07` | `c1e8f5a37d92` |
| reservas_user_id_nullable (Issue 14.5) | `d5b3c8e1f742` | `c3f81a5d9e07` |

Cada vez que se integra una migración nueva hay que sumarla a esta tabla.

## Crear una migración

1. Actualizar `main` y partir de ahí:
   ```bash
   git checkout main && git pull origin main
   git checkout -b feature/nombre-de-la-tarea
   ```
2. Confirmar el head vigente con `alembic heads`. Ese es el `down_revision` de la migración nueva.
3. Crear el archivo en `backend/alembic/versions/` con un id propio (12 caracteres hexadecimales) y escribirlo a mano. No usar `--autogenerate` sobre una base local desactualizada porque arrastra cambios que no son de la tarea.
4. Incluir siempre `downgrade()` y, si ya hay datos, el relleno (backfill) necesario.
5. Si hay un modelo nuevo, importarlo en `alembic/env.py` y en `tests/conftest.py`. Si no, el autogenerate no lo ve y los tests no crean su tabla.
6. Una sola migración por Pull Request.

## Probar la migración (en una base limpia)

La base tiene que estar vacía, porque `reset_db.py` crea las tablas con los modelos y no pasa por Alembic.

```bash
cd backend
docker-compose down -v && docker-compose up -d    # base nueva y vacía
pipenv run alembic upgrade head                   # aplica toda la cadena
pipenv run alembic downgrade -1                   # revierte la última
pipenv run alembic upgrade head                   # la vuelve a aplicar
pipenv run alembic heads                          # una sola línea
```

Los tests usan `create_all`, por lo que no prueban las migraciones: este paso hay que hacerlo a mano antes de abrir el Pull Request.

Después de traer cambios de modelo de otros compañeros, la base local ya creada no recibe las columnas nuevas: se resetea con `reset_db.py` o `docker-compose down -v`.

## Integrar la migración (orden de llegada)

El orden previsto es P1 (`usuarios`), P2 (reservas, personas, descuentos) y P4 (ingresos e incidentes), pero no hace falta esperar: quien mergea después ajusta su `down_revision`.

**Si mi migración llega primero a `main`:**

1. Antes de mergear: `git fetch origin && git rebase origin/main`, `alembic heads` y confirmar una sola línea.
2. Avisar al grupo el id de la revisión nueva (por ejemplo `b7d4e2a91c58`).
3. Agregar la fila a la tabla de este documento.

**Si otra migración llegó antes que la mía:**

1. `git fetch origin && git rebase origin/main`. Si hay conflicto en `alembic/env.py` o `tests/conftest.py`, se resuelve conservando los imports de ambos.
2. Abrir mi archivo de migración y cambiar `down_revision` por la revisión que quedó como head en `main` (se ve con `alembic heads`). También actualizar la línea `Revises:` del comentario del encabezado.
3. Correr de nuevo los pasos de "Probar la migración" en una base limpia.
4. Confirmar que `alembic heads` muestra una sola línea y recién ahí mergear.

**Reglas generales:**

- Una migración que ya está en `main` no se edita; si hay que corregirla, se crea otra.
- Un solo head antes de cada merge. Si `alembic heads` muestra dos líneas, no se mergea.
- Las variables de entorno nuevas se agregan a `.env.example` y a `core/config.py` con un valor por defecto.

## Agregar un valor a un enum de PostgreSQL

Dentro de la transacción normal puede fallar. Se hace así:

```python
with op.get_context().autocommit_block():
    op.execute("ALTER TYPE estadoreservaenum ADD VALUE 'ALERTA_CLONACION'")
```
