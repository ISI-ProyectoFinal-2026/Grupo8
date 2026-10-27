"""ingreso manual en efectivo: jti, cantidad_personas, monto_cobrado, nombre y dni

Revision ID: c3f81a5d9e07
Revises: b7d4e2a91c58
"""
from alembic import op
import sqlalchemy as sa

revision = "c3f81a5d9e07"
down_revision = "c1e8f5a37d92"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ingresos_fisicos", sa.Column("jti", sa.String(length=64), nullable=True))
    op.add_column("ingresos_fisicos", sa.Column("cantidad_personas", sa.Integer(), nullable=True))
    op.add_column("ingresos_fisicos", sa.Column("monto_cobrado", sa.Numeric(10, 2), nullable=True))
    op.add_column("ingresos_fisicos", sa.Column("nombre", sa.String(length=120), nullable=True))
    op.add_column("ingresos_fisicos", sa.Column("dni", sa.String(length=20), nullable=True))
    op.create_unique_constraint("uq_ingresos_fisicos_jti", "ingresos_fisicos", ["jti"])


def downgrade() -> None:
    op.drop_constraint("uq_ingresos_fisicos_jti", "ingresos_fisicos", type_="unique")
    op.drop_column("ingresos_fisicos", "dni")
    op.drop_column("ingresos_fisicos", "nombre")
    op.drop_column("ingresos_fisicos", "monto_cobrado")
    op.drop_column("ingresos_fisicos", "cantidad_personas")
    op.drop_column("ingresos_fisicos", "jti")