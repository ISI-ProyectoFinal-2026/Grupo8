"""reservas: DNI del titular y descuento de socio en reservas por unidad (cabaña)

Revision ID: e4a7c2d91f56
Revises: 249835143d19
"""
from alembic import op
import sqlalchemy as sa

revision = "e4a7c2d91f56"
down_revision = "249835143d19"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Opcionales: solo las reservas por unidad que se hicieron con el DNI de un socio los usan.
    # Las reservas por persona guardan estos datos en cada fila de reserva_personas
    op.add_column("reservas", sa.Column("dni_titular", sa.String(), nullable=True))
    op.add_column("reservas", sa.Column("descuento_pct", sa.Numeric(5, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("reservas", "descuento_pct")
    op.drop_column("reservas", "dni_titular")
