"""alerta de clonación: estado nuevo en el enum, fecha de alerta y dispositivo_id

Revision ID: e5b3a7c91d24
Revises: c3f81a5d9e07
"""
from alembic import op
import sqlalchemy as sa

revision = "e5b3a7c91d24"
down_revision = "d5b3c8e1f742"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ADD VALUE no puede usarse en la misma transacción en Postgres viejos,
    # por eso va en un bloque con autocommit
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE estadoreservaenum ADD VALUE IF NOT EXISTS 'ALERTA_CLONACION'")

    op.add_column("reservas", sa.Column("fecha_alerta_clonacion", sa.DateTime(), nullable=True))
    op.add_column("ingresos_fisicos", sa.Column("dispositivo_id", sa.String(length=64), nullable=True))
    op.add_column("conflictos_sincronizacion", sa.Column("dispositivo_id", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("conflictos_sincronizacion", "dispositivo_id")
    op.drop_column("ingresos_fisicos", "dispositivo_id")
    op.drop_column("reservas", "fecha_alerta_clonacion")

    # Postgres no permite quitar un valor de un enum: se recrea el tipo.
    # Las reservas en alerta vuelven a CONFIRMADA porque ese estado deja de existir.
    op.execute("UPDATE reservas SET estado_reserva = 'CONFIRMADA' WHERE estado_reserva = 'ALERTA_CLONACION'")
    op.execute("ALTER TYPE estadoreservaenum RENAME TO estadoreservaenum_old")
    op.execute("CREATE TYPE estadoreservaenum AS ENUM ('PENDIENTE', 'CONFIRMADA', 'CANCELADA', 'FINALIZADA')")
    op.execute(
        "ALTER TABLE reservas ALTER COLUMN estado_reserva TYPE estadoreservaenum "
        "USING estado_reserva::text::estadoreservaenum"
    )
    op.execute("DROP TYPE estadoreservaenum_old")