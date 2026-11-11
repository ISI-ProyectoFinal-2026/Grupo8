"""reservas: precio del tipo de reserva al momento de reservar

Revision ID: d3f9b6a2c514
Revises: c7e1a4d9b382
"""
from alembic import op
import sqlalchemy as sa

revision = "d3f9b6a2c514"
down_revision = "c7e1a4d9b382"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Opcional: las reservas anteriores a la Issue 19 no tienen tipo ni precio de tipo
    op.add_column("reservas", sa.Column("precio_tipo", sa.Numeric(10, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("reservas", "precio_tipo")
