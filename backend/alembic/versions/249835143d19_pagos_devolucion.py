"""pagos: monto, fecha y estado de la devolución

Revision ID: 249835143d19
Revises: 1f4c9f6757e0
"""
from alembic import op
import sqlalchemy as sa

revision = "249835143d19"
down_revision = "1f4c9f6757e0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nulas: los pagos que ya existen no tienen ninguna devolución
    op.add_column("pagos", sa.Column("monto_devuelto", sa.Numeric(12, 2), nullable=True))
    op.add_column("pagos", sa.Column("fecha_devolucion", sa.DateTime(timezone=True), nullable=True))
    op.add_column("pagos", sa.Column("devolucion_estado", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("pagos", "devolucion_estado")
    op.drop_column("pagos", "fecha_devolucion")
    op.drop_column("pagos", "monto_devuelto")
