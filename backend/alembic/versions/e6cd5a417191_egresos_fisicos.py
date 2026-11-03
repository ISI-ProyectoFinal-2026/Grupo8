"""egresos físicos: salidas del camping registradas por el administrador

Revision ID: e6cd5a417191
Revises: b9e6d3a47c15
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e6cd5a417191"
down_revision = "b9e6d3a47c15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "egresos_fisicos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("cantidad_personas", sa.Integer(), nullable=False),
        sa.Column("fecha_hora_egreso", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "registrado_por_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("usuarios.id"), nullable=False,
        ),
        # Respaldo en la base: nunca se guarda un egreso de cero o menos personas
        sa.CheckConstraint("cantidad_personas >= 1", name="ck_egresos_fisicos_cantidad_positiva"),
    )
    op.create_index("ix_egresos_fisicos_fecha_hora_egreso", "egresos_fisicos", ["fecha_hora_egreso"])
    op.create_index("ix_egresos_fisicos_registrado_por_id", "egresos_fisicos", ["registrado_por_id"])


def downgrade() -> None:
    op.drop_table("egresos_fisicos")