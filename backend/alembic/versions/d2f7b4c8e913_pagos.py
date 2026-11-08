"""pagos: registro de cada pago informado por Mercado Pago (Issue 17.1)

Revision ID: d2f7b4c8e913
Revises: e6cd5a417191
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d2f7b4c8e913"
down_revision = "e6cd5a417191"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Tabla nueva: no hay filas existentes que rellenar
    op.create_table(
        "pagos",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "reserva_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("reservas.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("mp_payment_id", sa.String(64), nullable=False),
        sa.Column("estado", sa.String(32), nullable=False),
        sa.Column("estado_detalle", sa.String(64), nullable=True),
        sa.Column("monto", sa.Numeric(12, 2), nullable=True),
        sa.Column("moneda", sa.String(3), nullable=True),
        sa.Column("metodo_pago", sa.String(32), nullable=True),
        sa.Column("fecha_creacion", sa.DateTime(timezone=True), nullable=False),
        sa.Column("fecha_aprobacion", sa.DateTime(timezone=True), nullable=True),
        sa.Column("respuesta_mp", postgresql.JSONB(), nullable=False),
        sa.UniqueConstraint("mp_payment_id", name="pagos_mp_payment_id_key"),
    )
    op.create_index("ix_pagos_reserva_id", "pagos", ["reserva_id"])


def downgrade() -> None:
    op.drop_table("pagos")
