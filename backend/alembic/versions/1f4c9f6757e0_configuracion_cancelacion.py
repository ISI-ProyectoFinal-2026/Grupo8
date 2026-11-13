"""configuración del camping: plazo de cancelación y porcentaje de devolución

Revision ID: 1f4c9f6757e0
Revises: d3f9b6a2c514
"""
from alembic import op
import sqlalchemy as sa

revision = "1f4c9f6757e0"
down_revision = "d3f9b6a2c514"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Con server_default los campings que ya existen quedan con 1 día y 100 % de devolución
    op.add_column(
        "configuracion_camping",
        sa.Column("dias_cancelacion", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "configuracion_camping",
        sa.Column("porcentaje_devolucion", sa.Integer(), nullable=False, server_default="100"),
    )


def downgrade() -> None:
    op.drop_column("configuracion_camping", "porcentaje_devolucion")
    op.drop_column("configuracion_camping", "dias_cancelacion")
