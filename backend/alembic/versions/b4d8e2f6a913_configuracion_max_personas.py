"""configuración del camping: máximo de personas por reserva

Revision ID: b4d8e2f6a913
Revises: a6e2c9d14f83
"""
import os

from alembic import op
import sqlalchemy as sa

revision = "b4d8e2f6a913"
down_revision = "a6e2c9d14f83"
branch_labels = None
depends_on = None

# La fila que ya existe toma el valor que hoy tiene el .env (env.py ya lo cargó)
MAX_PERSONAS_POR_RESERVA = int(os.getenv("MAX_PERSONAS_POR_RESERVA", "10"))


def upgrade() -> None:
    # Se agrega nullable, se completa la fila existente y recién ahí se vuelve obligatoria
    op.add_column(
        "configuracion_camping",
        sa.Column("max_personas_por_reserva", sa.Integer(), nullable=True),
    )
    op.execute(
        sa.text("UPDATE configuracion_camping SET max_personas_por_reserva = :valor").bindparams(
            valor=MAX_PERSONAS_POR_RESERVA
        )
    )
    op.alter_column("configuracion_camping", "max_personas_por_reserva", nullable=False)


def downgrade() -> None:
    op.drop_column("configuracion_camping", "max_personas_por_reserva")
